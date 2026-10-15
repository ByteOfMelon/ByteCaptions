//! Speaker separation using pyannote community-1, via a vendored speakrs package. Its models download on first use

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use speakrs::{ExecutionMode, PipelineBuilder};
use tauri::{AppHandle, State, ipc::Channel};

use crate::jobs::{CANCELLED, Jobs};
use crate::media;
use crate::models::{self, DownloadProgress};

const SAMPLE_RATE: u32 = 16_000;
const REVISION: &str = "67f963b6a1d94fcd4678948237b3cc8bd69bf1d8";
const BASE_URL: &str = "https://huggingface.co/avencera/speakrs-models/resolve";

/// The model files speakrs's CPU mode reads: name, SHA-256, size in bytes
const FILES: &[(&str, &str, u64)] = &[
	(
		"plda_lda.npy",
		"e20c9b012bebd1aabda5a38a127e63a43cf35debdc502715fc143e2fb6bc3c4b",
		131_200,
	),
	(
		"plda_mean1.npy",
		"e424c0c352182aa8e0f555dec1f3b30e29a20b9ed6b25d339f112af92e51e36f",
		2_176,
	),
	(
		"plda_mean2.npy",
		"6f6fb708a2037197b5b84ffeaa8f140cb878088fbecd6ab042ad26a7691bd2cf",
		640,
	),
	(
		"plda_mu.npy",
		"d286d48acf99bbc1ed1502fed0a3e361ae5626ce1870c8be9f7397c5e47886c6",
		1_152,
	),
	(
		"plda_psi.npy",
		"d7128c9ed2f28a9781971805131129f077c04f948e2df12e52dcdb99f2b4e5f5",
		1_152,
	),
	(
		"plda_tr.npy",
		"e700b68cb319de3fafb5fa093eb9222c23c447084741f8d3a533640d425510ee",
		131_200,
	),
	(
		"segmentation-3.0.onnx",
		"038b971741ed623af9773ecafdefa4b7bc523520099c2a68f8568b24189e8ad9",
		5_916_308,
	),
	(
		"wespeaker-voxceleb-resnet34.min_num_samples.txt",
		"e4df891c484d7abb985dadf539fa1883a646dab6337af5cae4159c587b7050cc",
		4,
	),
	(
		"wespeaker-voxceleb-resnet34.onnx",
		"203a4c67112167580ab1fcb62f4568c633499fb283805890aebe1c48564fcc0f",
		26_894_815,
	),
	(
		"wespeaker-voxceleb-resnet34.onnx.data",
		"dc105e7857156611381b95cc961b277d8e1e098e7af1c919a77c68c7257ce956",
		26_673_152,
	),
];

fn speakers_dir(app: &AppHandle) -> Result<PathBuf, String> {
	Ok(models::models_dir(app)?.join("speakers").join(REVISION))
}

fn installed(dir: &Path) -> bool {
	FILES.iter().all(|(name, _, bytes)| {
		std::fs::metadata(dir.join(name)).is_ok_and(|m| m.is_file() && m.len() == *bytes)
	})
}

#[tauri::command]
pub fn speakers_installed(app: AppHandle) -> bool {
	speakers_dir(&app).is_ok_and(|dir| installed(&dir))
}

#[tauri::command]
pub async fn speakers_download(
	app: AppHandle,
	jobs: State<'_, Jobs>,
	on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
	let dir = speakers_dir(&app)?;
	let cancel = jobs.start();
	let total: u64 = FILES.iter().map(|f| f.2).sum();
	let mut done = 0u64;
	for (name, sha256, bytes) in FILES {
		let target = dir.join(name);
		if !std::fs::metadata(&target).is_ok_and(|m| m.len() == *bytes) {
			// Report each file's progress as part of the whole
			let outer = on_progress.clone();
			let inner = Channel::new(move |body| {
				if let Ok(p) = body.deserialize::<serde_json::Value>() {
					let received = p["received"].as_u64().unwrap_or(0);
					let _ = outer.send(DownloadProgress {
						received: done + received,
						total,
					});
				}
				Ok(())
			});
			let url = format!("{BASE_URL}/{REVISION}/{name}");
			models::download_verified(&url, &target, sha256, *bytes, &cancel, &inner).await?;
		}
		done += bytes;
		let _ = on_progress.send(DownloadProgress {
			received: done,
			total,
		});
	}
	Ok(())
}

/// One speaker's stretch. Speakers are numbered by talk time, 0 is the most talkative
#[derive(Serialize)]
pub struct Turn {
	start: i64,
	end: i64,
	speaker: usize,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SpeakerEvent {
	/// The audio is decoded and the models are running
	Extracted,
}

fn run(
	dir: &Path,
	cancel: &AtomicBool,
	path: &Path,
	speakers: Option<usize>,
	events: &Channel<SpeakerEvent>,
) -> Result<Vec<Turn>, String> {
	if !installed(dir) {
		return Err("The speaker models aren't downloaded yet.".into());
	}
	let mut audio = Vec::new();
	media::decode_audio(path, SAMPLE_RATE, None, |samples| {
		audio.extend(samples.iter().map(|&s| s as f32 / 32768.0));
		!cancel.load(Ordering::Relaxed)
	})?;
	if cancel.load(Ordering::Relaxed) {
		return Err(CANCELLED.into());
	}
	if audio.is_empty() {
		return Err("This video's audio track is empty.".into());
	}
	let _ = events.send(SpeakerEvent::Extracted);

	let fail = |e: &dyn std::fmt::Display| format!("Speaker separation failed. ({e})");
	let mut pipeline = PipelineBuilder::from_dir(dir, ExecutionMode::Cpu)
		.build()
		.map_err(|e| fail(&e))?;
	let mut config = pipeline.pipeline_config();
	config.num_speakers = speakers.filter(|&k| k > 0);
	let result = pipeline
		.run_with_config(&audio, "media", &config)
		.map_err(|e| fail(&e))?;
	if cancel.load(Ordering::Relaxed) {
		return Err(CANCELLED.into());
	}
	let segments = result.discrete_diarization.to_segments();
	Ok(ranked(
		segments
			.iter()
			.map(|s| (s.start, s.end, s.speaker.to_string()))
			.collect(),
	))
}

/// Turns in milliseconds, with speakers renumbered by total talk time (most first)
fn ranked(segments: Vec<(f64, f64, String)>) -> Vec<Turn> {
	let mut talk: Vec<(String, f64)> = Vec::new();
	for (start, end, speaker) in &segments {
		match talk.iter_mut().find(|(s, _)| s == speaker) {
			Some((_, t)) => *t += end - start,
			None => talk.push((speaker.clone(), end - start)),
		}
	}
	talk.sort_by(|a, b| b.1.total_cmp(&a.1));
	let mut turns: Vec<Turn> = segments
		.into_iter()
		.map(|(start, end, speaker)| Turn {
			start: (start * 1000.0).round() as i64,
			end: (end * 1000.0).round() as i64,
			speaker: talk.iter().position(|(s, _)| *s == speaker).unwrap(),
		})
		.collect();
	turns.sort_by_key(|t| (t.start, t.end));
	turns
}

/// `speakers` is the exact number of people, or None to detect it
#[tauri::command]
pub async fn diarize(
	app: AppHandle,
	jobs: State<'_, Jobs>,
	path: String,
	speakers: Option<usize>,
	on_event: Channel<SpeakerEvent>,
) -> Result<Vec<Turn>, String> {
	let dir = speakers_dir(&app)?;
	let cancel = jobs.start();
	tauri::async_runtime::spawn_blocking(move || {
		run(&dir, &cancel, Path::new(&path), speakers, &on_event)
	})
	.await
	.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn speakers_are_ranked_by_talk_time() {
		let turns = ranked(vec![
			(0.0, 1.0, "A".into()),
			(1.0, 5.0, "B".into()),
			(5.0, 6.5, "A".into()),
		]);
		let got: Vec<_> = turns.iter().map(|t| (t.start, t.end, t.speaker)).collect();
		assert_eq!(got, [(0, 1000, 1), (1000, 5000, 0), (5000, 6500, 1)]);
	}
}
