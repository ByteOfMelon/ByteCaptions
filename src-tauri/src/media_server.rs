//! Linux only. Serves local videos via a local web server because WebKitGTK's player can't read Tauri's asset:// URLs

/// Base URL for media (http://127.0.0.1:<port>/<token>/ + the URL-encoded path), or None where asset:// works
#[tauri::command]
pub fn media_server() -> Result<Option<String>, String> {
	#[cfg(target_os = "linux")]
	{
		linux::base().map(Some)
	}
	#[cfg(not(target_os = "linux"))]
	{
		Ok(None)
	}
}

#[cfg(target_os = "linux")]
mod linux {
	use std::io::{Read, Seek, SeekFrom};
	use std::sync::OnceLock;
	use tokio::io::{AsyncReadExt, AsyncWriteExt};
	use tokio::net::{TcpListener, TcpStream};

	static BASE: OnceLock<Result<String, String>> = OnceLock::new();
	/// Bytes sent per write while streaming a file
	const CHUNK: usize = 256 * 1024;

	pub fn base() -> Result<String, String> {
		BASE.get_or_init(start).clone()
	}

	fn start() -> Result<String, String> {
		let mut bytes = [0u8; 16];
		getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
		let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
		let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
		listener.set_nonblocking(true).map_err(|e| e.to_string())?;
		let port = listener.local_addr().map_err(|e| e.to_string())?.port();
		let prefix = format!("/{token}/");
		tauri::async_runtime::spawn(async move {
			let Ok(listener) = TcpListener::from_std(listener) else {
				return;
			};
			while let Ok((stream, _)) = listener.accept().await {
				let prefix = prefix.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(e) = serve(stream, &prefix).await {
						log::debug!("media server: {e}");
					}
				});
			}
		});
		Ok(format!("http://127.0.0.1:{port}/{token}/"))
	}

	/// One request per connection
	async fn serve(mut stream: TcpStream, prefix: &str) -> std::io::Result<()> {
		let mut head = Vec::new();
		let mut buf = [0u8; 4096];
		while !head.windows(4).any(|w| w == b"\r\n\r\n") {
			let n = stream.read(&mut buf).await?;
			if n == 0 || head.len() > 64 * 1024 {
				return Ok(());
			}
			head.extend_from_slice(&buf[..n]);
		}
		let head = String::from_utf8_lossy(&head);
		let mut lines = head.split("\r\n");
		let mut first = lines.next().unwrap_or("").split(' ');
		let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
		let range = lines
			.filter_map(|l| l.split_once(':'))
			.find(|(k, _)| k.eq_ignore_ascii_case("range"))
			.map(|(_, v)| v.trim().to_string());

		let path = target
			.strip_prefix(prefix)
			.and_then(|p| urlencoding_decode(p.split('?').next().unwrap_or(p)));
		let (Some(path), true) = (path, method == "GET" || method == "HEAD") else {
			return respond(&mut stream, "404 Not Found", &[]).await;
		};
		let Ok(mut file) = std::fs::File::open(&path) else {
			return respond(&mut stream, "404 Not Found", &[]).await;
		};
		let size = file.metadata()?.len();
		let (start, end, status) = match range.as_deref().and_then(|r| parse_range(r, size)) {
			Some((s, e)) => (s, e, "206 Partial Content"),
			None if range.is_some() => {
				let cr = format!("bytes */{size}");
				return respond(
					&mut stream,
					"416 Range Not Satisfiable",
					&[("Content-Range", &cr)],
				)
				.await;
			}
			None => (0, size.saturating_sub(1), "200 OK"),
		};
		let len = if size == 0 { 0 } else { end - start + 1 };
		let content_range = format!("bytes {start}-{end}/{size}");
		let mut headers = vec![("Content-Type", mime(&path)), ("Accept-Ranges", "bytes")];
		if status.starts_with("206") {
			headers.push(("Content-Range", &content_range));
		}
		let len_text = len.to_string();
		headers.push(("Content-Length", &len_text));
		respond(&mut stream, status, &headers).await?;
		if method == "HEAD" || len == 0 {
			return Ok(());
		}
		file.seek(SeekFrom::Start(start))?;
		let mut left = len;
		let mut chunk = vec![0u8; CHUNK];
		while left > 0 {
			let want = (left as usize).min(CHUNK);
			let n = file.read(&mut chunk[..want])?;
			if n == 0 {
				break;
			}
			if stream.write_all(&chunk[..n]).await.is_err() {
				return Ok(());
			}
			left -= n as u64;
		}
		Ok(())
	}

	/// Write the status line and headers
	async fn respond(
		stream: &mut TcpStream,
		status: &str,
		headers: &[(&str, &str)],
	) -> std::io::Result<()> {
		let mut out = format!(
			"HTTP/1.1 {status}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n"
		);
		for (k, v) in headers {
			out.push_str(&format!("{k}: {v}\r\n"));
		}
		if headers.iter().all(|(k, _)| *k != "Content-Length") {
			out.push_str("Content-Length: 0\r\n");
		}
		out.push_str("\r\n");
		stream.write_all(out.as_bytes()).await
	}

	fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
		let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
		let (a, b) = spec.split_once('-')?;
		let last = size.checked_sub(1)?;
		let (start, end) = match (a.trim(), b.trim()) {
			("", n) => (size.saturating_sub(n.parse().ok()?), last),
			(s, "") => (s.parse().ok()?, last),
			(s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(last)),
		};
		(start <= end).then_some((start, end))
	}

	fn urlencoding_decode(s: &str) -> Option<String> {
		let bytes = s.as_bytes();
		let mut out = Vec::with_capacity(bytes.len());
		let mut i = 0;
		while i < bytes.len() {
			if bytes[i] == b'%' {
				let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
				out.push(u8::from_str_radix(hex, 16).ok()?);
				i += 3;
			} else {
				out.push(bytes[i]);
				i += 1;
			}
		}
		String::from_utf8(out).ok()
	}

	fn mime(path: &str) -> &'static str {
		match path
			.rsplit('.')
			.next()
			.map(|e| e.to_ascii_lowercase())
			.as_deref()
		{
			Some("mp4" | "m4v") => "video/mp4",
			Some("mov") => "video/quicktime",
			Some("webm") => "video/webm",
			Some("mkv") => "video/x-matroska",
			Some("mp3") => "audio/mpeg",
			Some("m4a") => "audio/mp4",
			Some("wav") => "audio/wav",
			Some("ogg" | "opus") => "audio/ogg",
			_ => "application/octet-stream",
		}
	}

	#[cfg(test)]
	mod tests {
		use super::*;

		#[test]
		fn ranges() {
			assert_eq!(parse_range("bytes=0-", 10), Some((0, 9)));
			assert_eq!(parse_range("bytes=2-4", 10), Some((2, 4)));
			assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
			assert_eq!(parse_range("bytes=5-100", 10), Some((5, 9)));
			assert_eq!(parse_range("bytes=12-", 10), None);
		}

		#[test]
		fn decodes_paths() {
			assert_eq!(
				urlencoding_decode("%2Fhome%2Fa%20b.mp4").as_deref(),
				Some("/home/a b.mp4")
			);
		}
	}
}
