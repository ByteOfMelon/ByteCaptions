fn main() {
	// Load the Vulkan loader (linked by whisper.cpp's GPU backend) on first use instead of at
	// startup, so the app runs on PCs without one; see src/gpu.rs.
	if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
		println!("cargo:rustc-link-arg=/DELAYLOAD:vulkan-1.dll");
		println!("cargo:rustc-link-arg=delayimp.lib");
	}
	tauri_build::build()
}
