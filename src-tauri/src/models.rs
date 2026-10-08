//! Whisper model files (ggml format), downloaded on first use from the whisper.cpp model
//! repository on Hugging Face into the app's data folder. Each download is checked against
//! the SHA-256 Hugging Face publishes for the file before it's put in place.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, ipc::Channel};

use crate::jobs::{CANCELLED, Jobs};

const BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const VAD_BASE_URL: &str = "https://huggingface.co/ggml-org/whisper-vad/resolve/main";

/// Voice activity detection model (Silero, 0.9 MB), used to skip stretches without speech.
pub const VAD_MODEL: &str = "silero-v6.2.0";

/// Models the app may download (PLAN §5.2.1: the default and alternatives for each tier).
const MODELS: &[&str] = &[
	"base",
	"small",
	"small-q5_1",
	"large-v3-turbo",
	"large-v3-turbo-q8_0",
	"large-v3-turbo-q5_0",
	"large-v3",
	"large-v3-q5_0",
	"large-v2",
	VAD_MODEL,
];

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
	Ok(app
		.path()
		.app_data_dir()
		.map_err(|e| e.to_string())?
		.join("models"))
}

/// Where a model lives once downloaded. Errors for names outside the catalog.
pub fn model_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
	if !MODELS.contains(&name) {
		return Err(format!("Unknown model: {name}"));
	}
	Ok(models_dir(app)?.join(format!("ggml-{name}.bin")))
}

/// Names of the models that are downloaded.
#[tauri::command]
pub fn models_installed(app: AppHandle) -> Vec<String> {
	MODELS
		.iter()
		.filter(|m| model_path(&app, m).is_ok_and(|p| p.is_file()))
		.map(|m| m.to_string())
		.collect()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
	received: u64,
	total: u64,
}

/// Download a model, reporting progress. Resolves once it's verified and in place.
#[tauri::command]
pub async fn model_download(
	app: AppHandle,
	jobs: State<'_, Jobs>,
	name: String,
	on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
	let target = model_path(&app, &name)?;
	if target.is_file() {
		return Ok(());
	}
	let cancel = jobs.start();
	let base = if name == VAD_MODEL {
		VAD_BASE_URL
	} else {
		BASE_URL
	};
	let url = format!("{base}/ggml-{name}.bin");
	let offline = |e: reqwest::Error| {
		format!("Couldn't reach Hugging Face to download the model. Check your connection. ({e})")
	};

	// The first response is a redirect to the CDN that carries the file's hash and size.
	let probe = reqwest::Client::builder()
		.redirect(reqwest::redirect::Policy::none())
		.build()
		.map_err(|e| e.to_string())?
		.head(&url)
		.send()
		.await
		.map_err(offline)?;
	let header = |h: &str| {
		probe
			.headers()
			.get(h)
			.and_then(|v| v.to_str().ok())
			.map(|v| v.trim_matches('"').to_string())
	};
	let sha256 = header("x-linked-etag").ok_or("The model's checksum isn't available.")?;
	let total: u64 = header("x-linked-size")
		.and_then(|s| s.parse().ok())
		.unwrap_or(0);

	let mut res = reqwest::get(&url).await.map_err(offline)?;
	if !res.status().is_success() {
		return Err(format!("The model download failed ({}).", res.status()));
	}
	let total = res.content_length().unwrap_or(total);

	let dir = target.parent().unwrap();
	std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
	let part = target.with_extension("bin.part");
	let result = async {
		let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
		let mut hash = Sha256::new();
		let mut received = 0u64;
		let mut reported = Instant::now();
		let _ = on_progress.send(DownloadProgress { received, total });
		while let Some(chunk) = res
			.chunk()
			.await
			.map_err(|e| format!("The connection dropped while downloading the model. ({e})"))?
		{
			if cancel.load(Ordering::SeqCst) {
				return Err(CANCELLED.to_string());
			}
			file.write_all(&chunk)
				.map_err(|e| format!("Couldn't save the model. Is the disk full? ({e})"))?;
			hash.update(&chunk);
			received += chunk.len() as u64;
			if reported.elapsed() > Duration::from_millis(150) {
				reported = Instant::now();
				let _ = on_progress.send(DownloadProgress { received, total });
			}
		}
		file.flush().map_err(|e| e.to_string())?;
		let _ = on_progress.send(DownloadProgress { received, total });
		if format!("{:x}", hash.finalize()) != sha256 {
			return Err("The downloaded model is damaged. Try again.".to_string());
		}
		Ok(())
	}
	.await;

	match result {
		Ok(()) => std::fs::rename(&part, &target).map_err(|e| e.to_string()),
		Err(e) => {
			let _ = std::fs::remove_file(&part);
			Err(e)
		}
	}
}
