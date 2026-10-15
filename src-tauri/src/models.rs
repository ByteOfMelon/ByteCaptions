//! Whisper models (ggml), downloaded from Hugging Face on first use and checked against a SHA-256 hash

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

/// Silero VAD, used to skip stretches without speech
pub const VAD_MODEL: &str = "silero-v6.2.0";

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

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
	Ok(app
		.path()
		.app_data_dir()
		.map_err(|e| e.to_string())?
		.join("models"))
}

/// Errors for names outside the catalog
pub fn model_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
	if !MODELS.contains(&name) {
		return Err(format!("Unknown model: {name}"));
	}
	Ok(models_dir(app)?.join(format!("ggml-{name}.bin")))
}

#[derive(Serialize)]
pub struct InstalledModel {
	name: String,
	bytes: u64,
}

#[tauri::command]
pub fn models_installed(app: AppHandle) -> Vec<InstalledModel> {
	MODELS
		.iter()
		.filter_map(|m| {
			let meta = std::fs::metadata(model_path(&app, m).ok()?).ok()?;
			meta.is_file().then(|| InstalledModel {
				name: m.to_string(),
				bytes: meta.len(),
			})
		})
		.collect()
}

#[tauri::command]
pub fn model_delete(app: AppHandle, name: String) -> Result<(), String> {
	match std::fs::remove_file(model_path(&app, &name)?) {
		Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
			Err(format!("Couldn't delete the model. ({e})"))
		}
		_ => Ok(()),
	}
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
	pub received: u64,
	pub total: u64,
}

/// Resolves once the model is verified and in place
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

	// The first response is a redirect to the CDN that carries the file's hash and size
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

	download_verified(&url, &target, &sha256, total, &cancel, &on_progress).await
}

/// Download a file and verify its SHA-256 hash
pub async fn download_verified(
	url: &str,
	target: &std::path::Path,
	sha256: &str,
	total: u64,
	cancel: &std::sync::atomic::AtomicBool,
	on_progress: &Channel<DownloadProgress>,
) -> Result<(), String> {
	let mut res = reqwest::get(url).await.map_err(|e| {
		format!("Couldn't reach Hugging Face to download the model. Check your connection. ({e})")
	})?;
	if !res.status().is_success() {
		return Err(format!("The model download failed ({}).", res.status()));
	}
	let total = res.content_length().unwrap_or(total);

	let dir = target.parent().unwrap();
	std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
	let mut part = target.as_os_str().to_owned();
	part.push(".part");
	let part = PathBuf::from(part);
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
		if hex(&hash.finalize()) != sha256 {
			return Err("The downloaded model is damaged. Try again.".to_string());
		}
		Ok(())
	}
	.await;

	match result {
		Ok(()) => std::fs::rename(&part, target).map_err(|e| e.to_string()),
		Err(e) => {
			let _ = std::fs::remove_file(&part);
			Err(e)
		}
	}
}

fn hex(bytes: &[u8]) -> String {
	bytes.iter().map(|b| format!("{b:02x}")).collect()
}
