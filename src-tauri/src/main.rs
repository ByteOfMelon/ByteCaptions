// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	// WebKitGTK's DMA-BUF renderer leaves the window blank on many Linux setups (NVIDIA
	// drivers, VMs, WSL). Turn it off unless the user chose otherwise; set before any threads.
	#[cfg(target_os = "linux")]
	if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
		// SAFETY: nothing else is running yet.
		unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
	}
	app_lib::run();
}
