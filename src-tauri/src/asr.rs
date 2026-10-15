//! Speech recognition using whisper.cpp

use std::ffi::c_void;
use std::path::Path;
use std::sync::Once;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, State, ipc::Channel};
use whisper_rs::{
	FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperVadContext,
	WhisperVadContextParams, WhisperVadParams,
};

use crate::jobs::{CANCELLED, Jobs};
use crate::{gpu, media, models};

/// Whisper expects 16 kHz mono
const SAMPLE_RATE: u32 = 16_000;
/// Amount of speech in ms kept on each side so that word edges aren't clipped
const SPEECH_PAD_MS: usize = 200;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AsrEvent {
	/// Audio decoded
	#[serde(rename_all = "camelCase")]
	Extracted { duration_ms: u64 },
	/// Percent of the audio processed
	Progress { percent: i32 },
	/// A recognized line
	#[serde(rename_all = "camelCase")]
	Segment {
		start_ms: i64,
		end_ms: i64,
		text: String,
	},
}

#[derive(Serialize)]
pub struct Word {
	text: String,
	start: i64,
	end: i64,
	/// Mean token probability, 0–1
	confidence: f32,
}

#[derive(Serialize)]
pub struct Transcript {
	words: Vec<Word>,
	/// The detected (or requested) language
	language: String,
}

/// whisper-rs's own safe abort callback mismatches its closure types, so poll the job's
/// cancel flag directly. `data` points at the AtomicBool, which outlives the run
unsafe extern "C" fn should_abort(data: *mut c_void) -> bool {
	unsafe { (*(data as *const AtomicBool)).load(Ordering::Relaxed) }
}

fn run(
	app: &AppHandle,
	cancel: &AtomicBool,
	path: &Path,
	model: &str,
	language: Option<&str>,
	range: Option<(u64, u64)>,
	events: &Channel<AsrEvent>,
) -> Result<Transcript, String> {
	static LOGGING: Once = Once::new();
	// Route whisper.cpp's logging into the `log` crate
	LOGGING.call_once(whisper_rs::install_logging_hooks);

	let model_path = models::model_path(app, model)?;
	if !model_path.is_file() {
		return Err("The model isn't downloaded yet.".into());
	}

	let mut audio = Vec::new();
	// Times come back relative to the audio decoded; shift them to the video's
	let offset = range.map_or(0, |(from, _)| from as i64);
	media::decode_audio(path, SAMPLE_RATE, range, |samples| {
		audio.extend(samples.iter().map(|&s| s as f32 / 32768.0));
		!cancel.load(Ordering::Relaxed)
	})?;
	if cancel.load(Ordering::Relaxed) {
		return Err(CANCELLED.into());
	}
	if audio.is_empty() {
		return Err("This video's audio track is empty.".into());
	}
	gate_speech(app, &mut audio);
	let _ = events.send(AsrEvent::Extracted {
		duration_ms: audio.len() as u64 * 1000 / SAMPLE_RATE as u64,
	});

	let device = gpu::prepare(app)?;
	let load = |device: Option<&gpu::Device>| -> Result<_, String> {
		let mut ctx_params = WhisperContextParameters::default();
		ctx_params.use_gpu(device.is_some());
		if let Some(d) = device {
			ctx_params.gpu_device(d.index);
		}
		let ctx = WhisperContext::new_with_params(&model_path, ctx_params).map_err(|e| {
			format!("Couldn't load the model. It may be damaged; try downloading it again. ({e})")
		})?;
		let state = ctx.create_state().map_err(|e| e.to_string())?;
		Ok((ctx, state))
	};
	// A GPU without the memory for the model (or with a broken driver) gets the CPU instead
	let (ctx, mut state) = match device.as_ref().map(|d| load(Some(d))) {
		Some(Ok(loaded)) => {
			log::info!("Transcribing on {}", device.as_ref().unwrap().name);
			loaded
		}
		Some(Err(e)) => {
			log::warn!("Couldn't use the GPU ({e}); transcribing on the CPU");
			load(None)?
		}
		None => load(None)?,
	};

	let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });
	let threads = std::thread::available_parallelism()
		.map_or(4, |n| n.get())
		.min(8);
	params.set_n_threads(threads as i32);
	params.set_language(Some(language.unwrap_or("auto")));
	params.set_token_timestamps(true);
	// Don't carry each window's text into the next b/c it corrupts the model over longer videos
	params.set_no_context(true);
	params.set_print_special(false);
	params.set_print_progress(false);
	params.set_print_realtime(false);
	params.set_print_timestamps(false);
	let progress = events.clone();
	params.set_progress_callback_safe(move |percent: i32| {
		let _ = progress.send(AsrEvent::Progress { percent });
	});
	let lines = events.clone();
	params.set_segment_callback_safe_lossy(move |s: whisper_rs::SegmentCallbackData| {
		let _ = lines.send(AsrEvent::Segment {
			start_ms: s.start_timestamp * 10 + offset,
			end_ms: s.end_timestamp * 10 + offset,
			text: s.text.trim().to_string(),
		});
	});
	unsafe {
		params.set_abort_callback(Some(should_abort));
		params.set_abort_callback_user_data(cancel as *const AtomicBool as *mut c_void);
	}

	let result = state.full(params, &audio);
	if cancel.load(Ordering::Relaxed) {
		return Err(CANCELLED.into());
	}
	result.map_err(|e| format!("Transcription failed. ({e})"))?;

	let language = whisper_rs::get_lang_str(state.full_lang_id_from_state())
		.unwrap_or("")
		.to_string();
	let mut words = words(&ctx, &state);
	for w in &mut words {
		w.start += offset;
		w.end += offset;
	}
	Ok(Transcript { words, language })
}

/// Mutes what the VAD model doesn't detect as speech so that Whisper doesn't get confused by music/background noise
fn gate_speech(app: &AppHandle, audio: &mut [f32]) {
	let Ok(path) = models::model_path(app, models::VAD_MODEL) else {
		return;
	};
	if !path.is_file() {
		return;
	}
	let mut ctx_params = WhisperVadContextParams::new();
	ctx_params.set_n_threads(4);
	let Ok(mut vad) = WhisperVadContext::new(&path.to_string_lossy(), ctx_params) else {
		log::warn!("Couldn't load the VAD model; transcribing all audio");
		return;
	};
	let Ok(segments) = vad.segments_from_samples(WhisperVadParams::new(), audio) else {
		log::warn!("Voice activity detection failed; transcribing all audio");
		return;
	};
	// Segment times are in centiseconds
	let pad = SPEECH_PAD_MS * SAMPLE_RATE as usize / 1000;
	let at = |cs: f32| ((cs as f64 / 100.0) * SAMPLE_RATE as f64) as usize;
	let mut keep_from = 0;
	for s in segments {
		let start = at(s.start).saturating_sub(pad).min(audio.len());
		audio[keep_from.min(start)..start].fill(0.0);
		keep_from = (at(s.end) + pad).min(audio.len());
	}
	audio[keep_from..].fill(0.0);
}

/// Whisper can get stuck repeating a line. This many in a row is taken as a loop and kept only once
const LOOP_REPEATS: usize = 3;

/// A segment's words compared to detect loops
fn loop_key(segment: &[Word]) -> String {
	segment
		.iter()
		.map(|w| {
			w.text
				.chars()
				.filter(|c| c.is_alphanumeric())
				.flat_map(char::to_lowercase)
				.collect::<String>()
		})
		.filter(|w| !w.is_empty())
		.collect::<Vec<_>>()
		.join(" ")
}

/// Flatten segments into words, keeping only the first line of each repetition loop
fn drop_loops(mut segments: Vec<Vec<Word>>) -> Vec<Word> {
	let keys: Vec<String> = segments.iter().map(|s| loop_key(s)).collect();
	let mut out = Vec::new();
	let mut i = 0;
	while i < segments.len() {
		let mut end = i + 1;
		while end < segments.len() && keys[end] == keys[i] {
			end += 1;
		}
		let keep = if end - i >= LOOP_REPEATS && !keys[i].is_empty() {
			log::info!("Dropped {} repeats of \"{}\"", end - i - 1, keys[i]);
			i + 1
		} else {
			end
		};
		for s in &mut segments[i..keep] {
			out.append(s);
		}
		i = end;
	}
	out
}

/// Whether a token starts with kana or a CJK ideograph, by its UTF-8 lead bytes. Chinese and Japanese don't space words, Korean does
fn starts_unspaced(bytes: &[u8]) -> bool {
	matches!(bytes, [0xE3, 0x81..=0xBF, ..] | [0xE4..=0xE9, ..])
}

/// Join tokens into words. Centiseconds become milliseconds
fn words(ctx: &WhisperContext, state: &whisper_rs::WhisperState) -> Vec<Word> {
	struct Pending {
		bytes: Vec<u8>,
		start: i64,
		end: i64,
		probs: Vec<f32>,
	}
	let mut segments = Vec::new();
	let flush = |w: Option<Pending>, out: &mut Vec<Word>| {
		let Some(w) = w else { return };
		let text = String::from_utf8_lossy(&w.bytes).trim().to_string();
		if text.is_empty() {
			return;
		}
		out.push(Word {
			text,
			start: w.start * 10,
			end: w.end.max(w.start) * 10,
			confidence: w.probs.iter().sum::<f32>() / w.probs.len() as f32,
		});
	};

	let eot = ctx.token_eot();
	for segment in state.as_iter() {
		let (seg_start, seg_end) = (segment.start_timestamp(), segment.end_timestamp());
		let mut out = Vec::new();
		let mut current: Option<Pending> = None;
		for i in 0..segment.n_tokens() {
			let Some(token) = segment.get_token(i) else {
				continue;
			};
			// Special tokens (end of text, timestamps, language...) sort after the text ones
			if token.token_id() >= eot {
				continue;
			}
			let Ok(bytes) = token.to_bytes() else {
				continue;
			};
			let data = token.token_data();
			let (t0, t1) = (
				data.t0.clamp(seg_start, seg_end),
				data.t1.clamp(seg_start, seg_end),
			);
			if bytes.first() == Some(&b' ') || starts_unspaced(bytes) || current.is_none() {
				flush(current.take(), &mut out);
				current = Some(Pending {
					bytes: Vec::new(),
					start: t0,
					end: t1,
					probs: Vec::new(),
				});
			}
			let w = current.as_mut().unwrap();
			w.bytes.extend_from_slice(bytes);
			w.end = t1;
			w.probs.push(data.p);
		}
		flush(current, &mut out);
		segments.push(out);
	}
	drop_loops(segments)
}

#[tauri::command]
pub async fn transcribe(
	app: AppHandle,
	jobs: State<'_, Jobs>,
	path: String,
	model: String,
	language: Option<String>,
	from_ms: Option<u64>,
	to_ms: Option<u64>,
	on_event: Channel<AsrEvent>,
) -> Result<Transcript, String> {
	let range = from_ms.zip(to_ms).filter(|(from, to)| to > from);
	let cancel = jobs.start();
	tauri::async_runtime::spawn_blocking(move || {
		run(
			&app,
			&cancel,
			Path::new(&path),
			&model,
			language.as_deref(),
			range,
			&on_event,
		)
	})
	.await
	.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
	use super::*;

	fn line(text: &str, at: i64) -> Vec<Word> {
		text.split(' ')
			.map(|t| Word {
				text: t.into(),
				start: at,
				end: at + 100,
				confidence: 1.0,
			})
			.collect()
	}

	fn texts(words: &[Word]) -> Vec<(&str, i64)> {
		words.iter().map(|w| (w.text.as_str(), w.start)).collect()
	}

	#[test]
	fn chinese_and_japanese_tokens_start_words() {
		assert!(starts_unspaced("我".as_bytes()));
		assert!(starts_unspaced("です".as_bytes()));
		assert!(starts_unspaced(&"我".as_bytes()[..2])); // first part of a split character
		assert!(!starts_unspaced(&"我".as_bytes()[2..])); // the rest of it
		assert!(!starts_unspaced("。".as_bytes()));
		assert!(!starts_unspaced("！".as_bytes()));
		assert!(!starts_unspaced(" 안녕".as_bytes()));
		assert!(!starts_unspaced("hello".as_bytes()));
	}

	#[test]
	fn keeps_a_line_said_twice() {
		let words = drop_loops(vec![
			line("Help.", 0),
			line("help", 1000),
			line("Run!", 2000),
		]);
		assert_eq!(
			texts(&words),
			[("Help.", 0), ("help", 1000), ("Run!", 2000)]
		);
	}

	#[test]
	fn keeps_the_first_line_of_a_loop() {
		let words = drop_loops(vec![
			line("Hi.", 0),
			line("I'm going in.", 1000),
			line("I'm going in.", 2000),
			line("i'm going in", 3000),
			line("Bye.", 4000),
		]);
		assert_eq!(
			texts(&words),
			[
				("Hi.", 0),
				("I'm", 1000),
				("going", 1000),
				("in.", 1000),
				("Bye.", 4000)
			]
		);
	}
}
