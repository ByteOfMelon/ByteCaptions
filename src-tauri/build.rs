fn main() {
	// Delay-load the Vulkan loader so the app starts on PCs without one (see src/gpu.rs)
	if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
		println!("cargo:rustc-link-arg=/DELAYLOAD:vulkan-1.dll");
		println!("cargo:rustc-link-arg=delayimp.lib");
	}
	google_client();
	directml();
	tauri_build::build()
}

/// YouTube's OAuth client, from google-oauth.json or the BC_GOOGLE_CLIENT_ID and
/// BC_GOOGLE_CLIENT_SECRET env vars. Without either, YouTube upload is off
fn google_client() {
	println!("cargo:rerun-if-changed=google-oauth.json");
	println!("cargo:rerun-if-env-changed=BC_GOOGLE_CLIENT_ID");
	println!("cargo:rerun-if-env-changed=BC_GOOGLE_CLIENT_SECRET");
	let Ok(text) = std::fs::read_to_string("google-oauth.json") else {
		return;
	};
	let json: serde_json::Value =
		serde_json::from_str(&text).expect("google-oauth.json isn't valid JSON");
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

/// Copy ort's DirectML.dll from target/<profile> to binaries/directml, where the bundle finds
/// it. On a clean checkout it may not exist yet: build again if Tauri says it's missing
fn directml() {
	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
		return;
	}
	let target = std::path::Path::new("binaries/directml/DirectML.dll");
	if target.is_file() {
		return;
	}
	let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
	// OUT_DIR is target/<profile>/build/app-<hash>/out
	let Some(profile_dir) = out.ancestors().nth(3) else {
		return;
	};
	let source = profile_dir.join("DirectML.dll");
	if source.is_file() {
		std::fs::create_dir_all("binaries/directml").unwrap();
		std::fs::copy(source, target).unwrap();
	}
}
