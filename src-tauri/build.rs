fn main() {
	// Load the Vulkan loader (linked by whisper.cpp's GPU backend) on first use instead of at
	// startup, so the app runs on PCs without one; see src/gpu.rs.
	if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
		println!("cargo:rustc-link-arg=/DELAYLOAD:vulkan-1.dll");
		println!("cargo:rustc-link-arg=delayimp.lib");
	}
	google_client();
	tauri_build::build()
}

/// The Google OAuth client for YouTube upload (src/youtube.rs), from the gitignored
/// google-oauth.json (as downloaded from Google Cloud) or the BC_GOOGLE_CLIENT_ID and
/// BC_GOOGLE_CLIENT_SECRET environment variables. Without either, YouTube upload is off.
fn google_client() {
	println!("cargo:rerun-if-changed=google-oauth.json");
	println!("cargo:rerun-if-env-changed=BC_GOOGLE_CLIENT_ID");
	println!("cargo:rerun-if-env-changed=BC_GOOGLE_CLIENT_SECRET");
	let Ok(text) = std::fs::read_to_string("google-oauth.json") else {
		return;
	};
	let json: serde_json::Value = serde_json::from_str(&text).expect("google-oauth.json isn't valid JSON");
	let client = json.get("installed").unwrap_or(&json);
	for (key, var) in [
		("client_id", "BC_GOOGLE_CLIENT_ID"),
		("client_secret", "BC_GOOGLE_CLIENT_SECRET"),
	] {
		if let Some(v) = client.get(key).and_then(|v| v.as_str()) {
			println!("cargo:rustc-env={var}={v}");
		}
	}
}
