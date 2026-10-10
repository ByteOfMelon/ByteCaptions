//! YouTube sign-in and caption upload
//!
//! Sign-in is Google's desktop flow: consent in the browser, redirected with a PKCE code to a
//! one-off loopback server. The refresh token lives in the OS keyring; access tokens only in
//! memory

use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State, ipc::Channel};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const API: &str = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API: &str = "https://www.googleapis.com/upload/youtube/v3";
/// Captions need this scope even to list them; it also covers listing the channel's videos
const SCOPE: &str = "https://www.googleapis.com/auth/youtube.force-ssl";
const KEYRING_SERVICE: &str = "ByteCaptions";
const KEYRING_USER: &str = "youtube";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Errors the dialog tells apart
#[derive(Debug, Serialize)]
pub struct YtError {
	/// "not-configured", "signed-out", "cancelled", "timeout", "quota", "forbidden",
	/// "not-found", "no-channel", "offline" or "failed"
	kind: &'static str,
	message: String,
}

fn err(kind: &'static str, message: impl Into<String>) -> YtError {
	YtError {
		kind,
		message: message.into(),
	}
}

fn offline(e: reqwest::Error) -> YtError {
	err("offline", format!("Couldn't reach YouTube. ({e})"))
}

#[derive(Default)]
pub struct YouTube {
	/// Access token and when it expires
	token: Mutex<Option<(String, Instant)>>,
	/// Cancels a sign-in waiting on the browser
	cancel: Notify,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
	id: String,
	title: String,
	thumbnail: String,
	/// Playlist of the channel's uploads, for listing its videos
	uploads: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
	id: String,
	title: String,
	channel_id: String,
	duration_ms: u64,
	/// "public", "unlisted" or "private"
	privacy: String,
	published_at: String,
	thumbnail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPage {
	videos: Vec<Video>,
	next_page_token: Option<String>,
	total: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Caption {
	id: String,
	language: String,
	name: String,
	is_draft: bool,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UploadEvent {
	Uploaded,
	Checked,
}

fn client() -> Result<(&'static str, &'static str), YtError> {
	match (
		option_env!("BC_GOOGLE_CLIENT_ID"),
		option_env!("BC_GOOGLE_CLIENT_SECRET"),
	) {
		// CI sets both empty when the repository has no Google secrets
		(Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Ok((id, secret)),
		_ => Err(err(
			"not-configured",
			"This build of ByteCaptions can't upload to YouTube.",
		)),
	}
}

fn keyring() -> Result<keyring::Entry, YtError> {
	keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
		.map_err(|e| err("failed", format!("Couldn't open secure storage. ({e})")))
}

fn stored_refresh_token() -> Result<Option<String>, YtError> {
	match keyring()?.get_password() {
		Ok(t) => Ok(Some(t)),
		Err(keyring::Error::NoEntry) => Ok(None),
		Err(e) => Err(err(
			"failed",
			format!("Couldn't read the sign-in from secure storage. ({e})"),
		)),
	}
}

fn forget_refresh_token() {
	if let Ok(entry) = keyring() {
		let _ = entry.delete_credential();
	}
}

fn random_code(bytes: usize) -> String {
	let mut buf = vec![0u8; bytes];
	getrandom::fill(&mut buf).expect("no system randomness");
	URL_SAFE_NO_PAD.encode(buf)
}

async fn read_json(res: reqwest::Response) -> Result<(StatusCode, Value), YtError> {
	let status = res.status();
	let bytes = res.bytes().await.map_err(offline)?;
	let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
	Ok((status, value))
}

async fn token_request(form: &[(&str, &str)]) -> Result<(StatusCode, Value), YtError> {
	let res = reqwest::Client::new()
		.post(TOKEN_URL)
		.form(form)
		.send()
		.await
		.map_err(offline)?;
	read_json(res).await
}

impl YouTube {
	fn remember(&self, token: &mut Option<(String, Instant)>, body: &Value) -> Option<String> {
		let access = body["access_token"].as_str()?.to_string();
		let ttl = body["expires_in"].as_u64().unwrap_or(3600);
		*token = Some((access.clone(), Instant::now() + Duration::from_secs(ttl)));
		Some(access)
	}

	/// A working access token, refreshed from the stored refresh token when needed
	async fn access_token(&self) -> Result<String, YtError> {
		let mut token = self.token.lock().await;
		if let Some((t, until)) = token.as_ref()
			&& *until > Instant::now() + Duration::from_secs(60)
		{
			return Ok(t.clone());
		}
		let (id, secret) = client()?;
		let Some(refresh) = stored_refresh_token()? else {
			return Err(err("signed-out", "Sign in to YouTube first."));
		};
		let (status, body) = token_request(&[
			("client_id", id),
			("client_secret", secret),
			("refresh_token", &refresh),
			("grant_type", "refresh_token"),
		])
		.await?;
		if status.is_success()
			&& let Some(access) = self.remember(&mut token, &body)
		{
			return Ok(access);
		}
		// Revoked, expired (Google ends test-mode sign-ins after a week) or otherwise refused
		if body["error"] == "invalid_grant" {
			forget_refresh_token();
			return Err(err("signed-out", "Your YouTube sign-in has expired."));
		}
		Err(err(
			"failed",
			format!("Google refused the sign-in. ({status} {})", body["error"]),
		))
	}

	/// Retries once with a fresh token on 401
	async fn call(
		&self,
		method: Method,
		url: &str,
		body: Option<(String, Vec<u8>)>,
	) -> Result<Value, YtError> {
		for attempt in 0..2 {
			let token = self.access_token().await?;
			let mut req = reqwest::Client::new()
				.request(method.clone(), url)
				.bearer_auth(token);
			if let Some((content_type, bytes)) = &body {
				req = req
					.header(reqwest::header::CONTENT_TYPE, content_type)
					.body(bytes.clone());
			}
			let (status, value) = read_json(req.send().await.map_err(offline)?).await?;
			if status.is_success() {
				return Ok(value);
			}
			if status == StatusCode::UNAUTHORIZED && attempt == 0 {
				*self.token.lock().await = None;
				continue;
			}
			return Err(api_error(status, &value));
		}
		Err(err("signed-out", "Your YouTube sign-in has expired."))
	}
}

fn api_error(status: StatusCode, body: &Value) -> YtError {
	let reason = body["error"]["errors"][0]["reason"].as_str().unwrap_or("");
	let message = body["error"]["message"].as_str().unwrap_or("").to_string();
	let detail = if message.is_empty() {
		status.to_string()
	} else {
		message
	};
	match (status, reason) {
		(StatusCode::UNAUTHORIZED, _) => err("signed-out", "Your YouTube sign-in has expired."),
		(_, "quotaExceeded" | "dailyLimitExceeded" | "rateLimitExceeded") => err("quota", detail),
		(StatusCode::FORBIDDEN, _) => err("forbidden", detail),
		(StatusCode::NOT_FOUND, _) => err("not-found", detail),
		_ => err("failed", detail),
	}
}

/// Wait for Google's redirect and return its code
async fn receive_code(listener: &TcpListener, state: &str) -> Result<String, YtError> {
	loop {
		let (mut stream, _) = listener
			.accept()
			.await
			.map_err(|e| err("failed", format!("Sign-in failed. ({e})")))?;
		let mut buf = vec![0u8; 8192];
		let mut len = 0;
		while len < buf.len() {
			let n = stream.read(&mut buf[len..]).await.unwrap_or(0);
			if n == 0 {
				break;
			}
			len += n;
			if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
				break;
			}
		}
		let request = String::from_utf8_lossy(&buf[..len]);
		let target = request.split_whitespace().nth(1).unwrap_or("/");
		let query = url::Url::parse(&format!("http://127.0.0.1{target}")).ok();
		let param = |name: &str| {
			query.as_ref().and_then(|u| {
				u.query_pairs()
					.find(|(k, _)| k == name)
					.map(|(_, v)| v.into_owned())
			})
		};
		let (code, error) = (param("code"), param("error"));
		// The browser may also ask for a favicon; only the redirect itself matters
		if code.is_none() && error.is_none() {
			let _ = stream
				.write_all(
					b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
				)
				.await;
			continue;
		}
		let ok = code.is_some() && param("state").as_deref() == Some(state);
		let message = if ok {
			"You're signed in. You can close this tab and go back to ByteCaptions."
		} else {
			"Sign-in didn't finish. You can close this tab and try again in ByteCaptions."
		};
		let page = format!(
			"<!doctype html><meta charset=utf-8><title>ByteCaptions</title>\
			<body style=\"font:16px system-ui,sans-serif;background:#151517;color:#fcfcfc;\
			display:grid;place-items:center;height:100vh;margin:0\"><p>{message}</p>"
		);
		let _ = stream
			.write_all(
				format!(
					"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
					Content-Length: {}\r\nConnection: close\r\n\r\n{page}",
					page.len()
				)
				.as_bytes(),
			)
			.await;
		return match (ok, error.as_deref()) {
			(true, _) => Ok(code.unwrap()),
			(false, Some("access_denied")) => Err(err("cancelled", "Sign-in was cancelled.")),
			(false, Some(e)) => Err(err("failed", format!("Google refused the sign-in. ({e})"))),
			(false, None) => Err(err("failed", "Sign-in didn't match this request.")),
		};
	}
}

/// Whether this build has an OAuth client
#[tauri::command]
pub fn youtube_available() -> bool {
	client().is_ok()
}

/// The signed-in channel, or None
#[tauri::command]
pub async fn youtube_account(yt: State<'_, YouTube>) -> Result<Option<Account>, YtError> {
	client()?;
	if stored_refresh_token()?.is_none() {
		return Ok(None);
	}
	let body = match yt
		.call(
			Method::GET,
			&format!("{API}/channels?part=snippet,contentDetails&mine=true"),
			None,
		)
		.await
	{
		Err(e) if e.kind == "signed-out" => return Ok(None),
		r => r?,
	};
	let Some(c) = body["items"].get(0) else {
		return Err(err(
			"no-channel",
			"This Google account doesn't have a YouTube channel.",
		));
	};
	Ok(Some(Account {
		id: c["id"].as_str().unwrap_or_default().into(),
		title: c["snippet"]["title"].as_str().unwrap_or_default().into(),
		thumbnail: c["snippet"]["thumbnails"]["default"]["url"]
			.as_str()
			.unwrap_or_default()
			.into(),
		uploads: c["contentDetails"]["relatedPlaylists"]["uploads"]
			.as_str()
			.unwrap_or_default()
			.into(),
	}))
}

/// Sign in through the browser and remember it. Returns the channel
#[tauri::command]
pub async fn youtube_sign_in(
	app: AppHandle,
	yt: State<'_, YouTube>,
) -> Result<Option<Account>, YtError> {
	let (id, secret) = client()?;
	let listener = TcpListener::bind("127.0.0.1:0")
		.await
		.map_err(|e| err("failed", format!("Couldn't start sign-in. ({e})")))?;
	let port = listener
		.local_addr()
		.map_err(|e| err("failed", e.to_string()))?
		.port();
	let redirect = format!("http://127.0.0.1:{port}");
	let verifier = random_code(48);
	let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
	let state = random_code(16);
	let auth = url::Url::parse_with_params(
		AUTH_URL,
		[
			("client_id", id),
			("redirect_uri", &redirect),
			("response_type", "code"),
			("scope", SCOPE),
			("code_challenge", &challenge),
			("code_challenge_method", "S256"),
			("state", &state),
			("access_type", "offline"),
			// Always ask, so Google returns a refresh token and lets you pick the account
			("prompt", "select_account consent"),
		],
	)
	.map_err(|e| err("failed", e.to_string()))?;
	app.opener()
		.open_url(auth.as_str(), None::<&str>)
		.map_err(|e| err("failed", format!("Couldn't open the browser. ({e})")))?;

	let code = tokio::select! {
		r = receive_code(&listener, &state) => r?,
		_ = yt.cancel.notified() => return Err(err("cancelled", "Sign-in was cancelled.")),
		_ = tokio::time::sleep(SIGN_IN_TIMEOUT) => {
			return Err(err("timeout", "Sign-in took too long. Try again."));
		}
	};
	drop(listener);

	let (status, body) = token_request(&[
		("client_id", id),
		("client_secret", secret),
		("code", &code),
		("code_verifier", &verifier),
		("redirect_uri", &redirect),
		("grant_type", "authorization_code"),
	])
	.await?;
	let Some(refresh) = body["refresh_token"]
		.as_str()
		.filter(|_| status.is_success())
	else {
		return Err(err(
			"failed",
			format!("Google refused the sign-in. ({status} {})", body["error"]),
		));
	};
	keyring()?.set_password(refresh).map_err(|e| {
		err(
			"failed",
			format!("Couldn't save the sign-in to secure storage. ({e})"),
		)
	})?;
	yt.remember(&mut *yt.token.lock().await, &body);
	youtube_account(yt).await
}

#[tauri::command]
pub fn youtube_cancel_sign_in(yt: State<'_, YouTube>) {
	yt.cancel.notify_waiters();
}

/// Forget the sign-in here and revoke it at Google
#[tauri::command]
pub async fn youtube_sign_out(yt: State<'_, YouTube>) -> Result<(), YtError> {
	*yt.token.lock().await = None;
	let refresh = stored_refresh_token()?;
	forget_refresh_token();
	if let Some(t) = refresh {
		// Best effort: the token is gone from this computer either way
		let _ = reqwest::Client::new()
			.post(REVOKE_URL)
			.form(&[("token", t.as_str())])
			.send()
			.await;
	}
	Ok(())
}

/// "PT1H2M3S" → milliseconds
fn iso_duration_ms(s: &str) -> u64 {
	let mut total = 0f64;
	let mut num = String::new();
	for c in s.chars() {
		match c {
			'0'..='9' | '.' => num.push(c),
			'H' | 'M' | 'S' | 'D' => {
				let n: f64 = num.parse().unwrap_or(0.0);
				num.clear();
				total += n * match c {
					'D' => 86_400.0,
					'H' => 3600.0,
					'M' => 60.0,
					_ => 1.0,
				};
			}
			_ => num.clear(),
		}
	}
	(total * 1000.0).round() as u64
}

fn video(v: &Value) -> Video {
	let s = &v["snippet"];
	let thumbs = &s["thumbnails"];
	Video {
		id: v["id"].as_str().unwrap_or_default().into(),
		title: s["title"].as_str().unwrap_or_default().into(),
		channel_id: s["channelId"].as_str().unwrap_or_default().into(),
		duration_ms: iso_duration_ms(v["contentDetails"]["duration"].as_str().unwrap_or("")),
		privacy: v["status"]["privacyStatus"]
			.as_str()
			.unwrap_or_default()
			.into(),
		published_at: s["publishedAt"].as_str().unwrap_or_default().into(),
		thumbnail: thumbs["medium"]["url"]
			.as_str()
			.or(thumbs["default"]["url"].as_str())
			.unwrap_or_default()
			.into(),
	}
}

async fn videos_by_id(yt: &YouTube, ids: &[String]) -> Result<Vec<Video>, YtError> {
	if ids.is_empty() {
		return Ok(Vec::new());
	}
	let body = yt
		.call(
			Method::GET,
			&format!(
				"{API}/videos?part=snippet,contentDetails,status&maxResults=50&id={}",
				ids.join(",")
			),
			None,
		)
		.await?;
	let found: Vec<Video> = body["items"]
		.as_array()
		.map(|a| a.iter().map(video).collect())
		.unwrap_or_default();
	// Keep the playlist's order (newest first)
	Ok(ids
		.iter()
		.filter_map(|id| found.iter().find(|v| &v.id == id).cloned())
		.collect())
}

/// The channel's uploads, 50 per page, newest first
#[tauri::command]
pub async fn youtube_videos(
	yt: State<'_, YouTube>,
	uploads: String,
	page_token: Option<String>,
) -> Result<VideoPage, YtError> {
	let mut url = url::Url::parse(&format!("{API}/playlistItems")).unwrap();
	url.query_pairs_mut()
		.append_pair("part", "contentDetails")
		.append_pair("maxResults", "50")
		.append_pair("playlistId", &uploads);
	if let Some(p) = &page_token {
		url.query_pairs_mut().append_pair("pageToken", p);
	}
	let body = yt.call(Method::GET, url.as_str(), None).await?;
	let ids: Vec<String> = body["items"]
		.as_array()
		.map(|a| {
			a.iter()
				.filter_map(|i| i["contentDetails"]["videoId"].as_str().map(String::from))
				.collect()
		})
		.unwrap_or_default();
	Ok(VideoPage {
		videos: videos_by_id(&yt, &ids).await?,
		next_page_token: body["nextPageToken"].as_str().map(String::from),
		total: body["pageInfo"]["totalResults"].as_u64().unwrap_or(0),
	})
}

/// One video by ID, e.g. pasted into the search box
#[tauri::command]
pub async fn youtube_video(yt: State<'_, YouTube>, id: String) -> Result<Option<Video>, YtError> {
	Ok(videos_by_id(&yt, &[id]).await?.into_iter().next())
}

/// A video's caption tracks, leaving out YouTube's automatic ones
#[tauri::command]
pub async fn youtube_captions(
	yt: State<'_, YouTube>,
	video_id: String,
) -> Result<Vec<Caption>, YtError> {
	let body = yt
		.call(
			Method::GET,
			&format!("{API}/captions?part=snippet&videoId={video_id}"),
			None,
		)
		.await?;
	Ok(body["items"]
		.as_array()
		.map(|a| {
			a.iter()
				.filter(|c| c["snippet"]["trackKind"] != "asr")
				.map(|c| Caption {
					id: c["id"].as_str().unwrap_or_default().into(),
					language: c["snippet"]["language"].as_str().unwrap_or_default().into(),
					name: c["snippet"]["name"].as_str().unwrap_or_default().into(),
					is_draft: c["snippet"]["isDraft"].as_bool().unwrap_or(false),
				})
				.collect()
		})
		.unwrap_or_default())
}

/// A multipart/related body: the caption's metadata, then its file
fn multipart(metadata: &Value, content: &str) -> (String, Vec<u8>) {
	let boundary = format!("bytecaptions-{}", random_code(12));
	let mut body = Vec::new();
	body.extend_from_slice(
		format!(
			"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
			--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n"
		)
		.as_bytes(),
	);
	body.extend_from_slice(content.as_bytes());
	body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
	(format!("multipart/related; boundary={boundary}"), body)
}

/// `replace` is an existing track in the same language: one with the same name is updated
/// in place; otherwise the new track is added and the old one deleted after, so a failed
/// upload never loses captions
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn youtube_upload(
	yt: State<'_, YouTube>,
	video_id: String,
	language: String,
	name: String,
	draft: bool,
	content: String,
	replace: Option<Caption>,
	on_event: Channel<UploadEvent>,
) -> Result<Caption, YtError> {
	let same = replace.as_ref().filter(|c| c.name == name);
	let id = if let Some(old) = same {
		let meta = json!({ "id": old.id, "snippet": { "isDraft": draft } });
		let body = yt
			.call(
				Method::PUT,
				&format!("{UPLOAD_API}/captions?part=snippet&uploadType=multipart"),
				Some(multipart(&meta, &content)),
			)
			.await?;
		body["id"].as_str().unwrap_or(&old.id).to_string()
	} else {
		let meta = json!({ "snippet": {
			"videoId": video_id, "language": language, "name": name, "isDraft": draft,
		}});
		let body = yt
			.call(
				Method::POST,
				&format!("{UPLOAD_API}/captions?part=snippet&uploadType=multipart"),
				Some(multipart(&meta, &content)),
			)
			.await?;
		let id = body["id"].as_str().unwrap_or_default().to_string();
		if let Some(old) = &replace {
			yt.call(
				Method::DELETE,
				&format!("{API}/captions?id={}", old.id),
				None,
			)
			.await
			.or_else(|e| {
				if e.kind == "not-found" {
					Ok(Value::Null)
				} else {
					Err(e)
				}
			})?;
		}
		id
	};
	let _ = on_event.send(UploadEvent::Uploaded);

	// Read it back, so "done" means YouTube has it
	let tracks = youtube_captions(yt, video_id).await?;
	let caption = tracks.into_iter().find(|c| c.id == id).ok_or_else(|| {
		err(
			"failed",
			"YouTube accepted the captions but doesn't list them yet. Check YouTube Studio in a minute.",
		)
	})?;
	let _ = on_event.send(UploadEvent::Checked);
	Ok(caption)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_iso_durations() {
		assert_eq!(iso_duration_ms("PT17M42S"), 1_062_000);
		assert_eq!(iso_duration_ms("PT1H2M3S"), 3_723_000);
		assert_eq!(iso_duration_ms("PT45S"), 45_000);
		assert_eq!(iso_duration_ms("P1DT1S"), 86_401_000);
		assert_eq!(iso_duration_ms("P0D"), 0);
	}

	#[test]
	fn multipart_wraps_metadata_and_file() {
		let (ct, body) = multipart(&json!({ "a": 1 }), "<timedtext/>");
		let boundary = ct.split("boundary=").nth(1).unwrap();
		let text = String::from_utf8(body).unwrap();
		assert!(text.starts_with(&format!("--{boundary}\r\n")));
		assert!(text.contains("{\"a\":1}"));
		assert!(text.contains("<timedtext/>"));
		assert!(text.ends_with(&format!("--{boundary}--\r\n")));
	}
}
