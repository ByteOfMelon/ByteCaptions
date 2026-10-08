//! Media jobs that need ffmpeg (bundled next to the app as a sidecar).
//! `decode_audio` is shared with transcription (asr.rs).
//!
//! `media_peaks` decodes a video's audio and returns its waveform: one byte per 1/100 s,
//! the loudest sample in that slice scaled to 0–255. Results are cached per file (path,
//! size and modified time), so a video is only decoded once.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Manager, ipc::Response};

/// Waveform resolution. Keep in sync with PEAKS_PER_SECOND in src/app/state/audio-peaks.ts.
const PEAKS_PER_SECOND: u32 = 100;
/// Decode rate: plenty for a waveform, and cheap.
const SAMPLE_RATE: u32 = 8000;
const SAMPLES_PER_PEAK: usize = (SAMPLE_RATE / PEAKS_PER_SECOND) as usize;
/// Bump to invalidate cached peaks when the format or scaling changes.
const CACHE_VERSION: u32 = 1;

/// The bundled ffmpeg: Tauri places sidecars next to the app's executable.
fn ffmpeg_path() -> Result<PathBuf, String> {
	let exe = std::env::current_exe().map_err(|e| e.to_string())?;
	let name = if cfg!(windows) {
		"ffmpeg.exe"
	} else {
		"ffmpeg"
	};
	let path = exe
		.parent()
		.map(|d| d.join(name))
		.ok_or("App folder not found")?;
	if path.exists() {
		Ok(path)
	} else {
		Err("ffmpeg is missing from the app folder. Reinstall ByteCaptions.".into())
	}
}

fn ffmpeg() -> Result<Command, String> {
	let mut cmd = Command::new(ffmpeg_path()?);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		// CREATE_NO_WINDOW: don't flash a console window.
		cmd.creation_flags(0x0800_0000);
	}
	Ok(cmd)
}

fn cache_file(app: &AppHandle, path: &Path) -> Option<PathBuf> {
	let meta = std::fs::metadata(path).ok()?;
	let mut h = DefaultHasher::new();
	(CACHE_VERSION, path, meta.len(), meta.modified().ok()).hash(&mut h);
	let dir = app.path().app_cache_dir().ok()?.join("peaks");
	Some(dir.join(format!("{:016x}.bin", h.finish())))
}

/**
 * Decode a file's first audio track to mono 16-bit samples at `rate`, passing them to `sink`
 * as they arrive. `sink` returns false to stop early (the job was cancelled).
 */
pub fn decode_audio(
	path: &Path,
	rate: u32,
	mut sink: impl FnMut(&[i16]) -> bool,
) -> Result<(), String> {
	let mut child = ffmpeg()?
		.args(["-nostdin", "-v", "error", "-i"])
		.arg(path)
		.args(["-map", "0:a:0", "-vn", "-ac", "1", "-ar"])
		.arg(rate.to_string())
		.args(["-f", "s16le", "pipe:1"])
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()
		.map_err(|e| format!("Couldn't start ffmpeg: {e}"))?;

	// Drain stderr on its own thread so a chatty ffmpeg can't block on a full pipe.
	let mut stderr = child.stderr.take().unwrap();
	let errors = std::thread::spawn(move || {
		let mut s = String::new();
		let _ = stderr.read_to_string(&mut s);
		s
	});

	let mut stdout = child.stdout.take().unwrap();
	let mut buf = vec![0u8; 64 * 1024];
	let mut samples = Vec::with_capacity(buf.len() / 2 + 1);
	let mut carry: Option<u8> = None;
	loop {
		let n = stdout.read(&mut buf).map_err(|e| e.to_string())?;
		if n == 0 {
			break;
		}
		let mut bytes = &buf[..n];
		samples.clear();
		// Samples are 2 bytes; a read can end halfway through one.
		if let Some(lo) = carry.take() {
			samples.push(i16::from_le_bytes([lo, bytes[0]]));
			bytes = &bytes[1..];
		}
		let (pairs, rest) = bytes.as_chunks::<2>();
		carry = rest.first().copied();
		samples.extend(pairs.iter().map(|&p| i16::from_le_bytes(p)));
		if !sink(&samples) {
			let _ = child.kill();
			let _ = child.wait();
			return Ok(());
		}
	}

	let status = child.wait().map_err(|e| e.to_string())?;
	let errors = errors.join().unwrap_or_default();
	if !status.success() {
		return Err(if errors.contains("matches no streams") {
			"This video has no audio track.".into()
		} else {
			format!(
				"ffmpeg couldn't read the audio. {}",
				errors.lines().last().unwrap_or("")
			)
		});
	}
	Ok(())
}

fn decode_peaks(path: &Path) -> Result<Vec<u8>, String> {
	let mut peaks = Vec::new();
	let (mut loudest, mut count) = (0u16, 0usize);
	decode_audio(path, SAMPLE_RATE, |samples| {
		for s in samples {
			loudest = loudest.max(s.unsigned_abs());
			count += 1;
			if count == SAMPLES_PER_PEAK {
				peaks.push(((loudest as u32 * 255) / 32768) as u8);
				(loudest, count) = (0, 0);
			}
		}
		true
	})?;
	if count > 0 {
		peaks.push(((loudest as u32 * 255) / 32768) as u8);
	}
	Ok(peaks)
}

fn peaks(app: &AppHandle, path: &Path) -> Result<Vec<u8>, String> {
	let cache = cache_file(app, path);
	if let Some(bytes) = cache.as_ref().and_then(|c| std::fs::read(c).ok()) {
		return Ok(bytes);
	}
	let peaks = decode_peaks(path)?;
	if let Some(c) = cache {
		// Caching is best-effort; a failure just means decoding again next time.
		let _ = c.parent().map(std::fs::create_dir_all);
		let _ = std::fs::write(c, &peaks);
	}
	Ok(peaks)
}

/// Waveform peaks for a media file, as raw bytes (an ArrayBuffer in JS).
#[tauri::command]
pub async fn media_peaks(app: AppHandle, path: String) -> Result<Response, String> {
	tauri::async_runtime::spawn_blocking(move || peaks(&app, Path::new(&path)))
		.await
		.map_err(|e| e.to_string())?
		.map(Response::new)
}
