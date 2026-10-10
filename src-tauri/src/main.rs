// No console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	// WebKitGTK's DMA-BUF renderer leaves the window blank on NVIDIA, VMs and WSL. Must be set
	// before any threads start
	#[cfg(target_os = "linux")]
	if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
		// SAFETY: nothing else is running yet
		unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
	}
	app_lib::run();
}
