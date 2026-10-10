//! Whisper on the GPU through Vulkan, falling back to the CPU
//!
//! The Windows build delay-loads vulkan-1.dll (build.rs) so the app starts without it.
//! `prepare` loads the system's loader, or the bundled copy if there isn't one

use tauri::AppHandle;

/// whisper.cpp's `gpu_device` index and a display name
pub struct Device {
	pub index: i32,
	pub name: String,
}

#[cfg(windows)]
fn ensure_loader(app: &AppHandle) -> Result<(), String> {
	use core::ffi::c_void;
	use std::os::windows::ffi::OsStrExt;
	use std::sync::OnceLock;
	use tauri::Manager;

	const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x0800;
	const LOAD_WITH_ALTERED_SEARCH_PATH: u32 = 0x0008;
	unsafe extern "system" {
		fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
	}
	// SAFETY: loads a DLL; the handle is kept for the life of the process
	let load = |path: &std::ffi::OsStr, flags: u32| {
		let wide: Vec<u16> = path.encode_wide().chain([0]).collect();
		!unsafe { LoadLibraryExW(wide.as_ptr(), std::ptr::null_mut(), flags) }.is_null()
	};

	static LOADED: OnceLock<Result<(), String>> = OnceLock::new();
	LOADED
		.get_or_init(|| {
			// Set to test the fallback on a PC that has a system loader
			let skip_system = std::env::var_os("BYTECAPTIONS_BUNDLED_VULKAN").is_some();
			if !skip_system && load("vulkan-1.dll".as_ref(), LOAD_LIBRARY_SEARCH_SYSTEM32) {
				return Ok(());
			}
			let bundled = app
				.path()
				.resource_dir()
				.map_err(|e| e.to_string())?
				.join("vulkan")
				.join("vulkan-1.dll");
			if load(bundled.as_os_str(), LOAD_WITH_ALTERED_SEARCH_PATH) {
				log::info!("Using the bundled Vulkan loader: {}", bundled.display());
				Ok(())
			} else {
				// whisper.cpp would crash resolving its delay-loaded Vulkan import
				Err("A file transcription needs is missing (vulkan-1.dll). Reinstalling ByteCaptions should fix it.".into())
			}
		})
		.clone()
}

#[cfg(not(windows))]
fn ensure_loader(_app: &AppHandle) -> Result<(), String> {
	Ok(())
}

/// Get whisper.cpp ready for the GPU and pick a device: the first dedicated GPU, else an
/// integrated one, else None (CPU). Left alone, whisper.cpp takes the first Vulkan device,
/// which is often the integrated graphics
pub fn prepare(app: &AppHandle) -> Result<Option<Device>, String> {
	ensure_loader(app)?;
	use whisper_rs::whisper_rs_sys as sys;
	let mut gpus = Vec::new();
	// SAFETY: plain queries of ggml's device registry (initialized on first use)
	unsafe {
		for i in 0..sys::ggml_backend_dev_count() {
			let dev = sys::ggml_backend_dev_get(i);
			let kind = sys::ggml_backend_dev_type(dev);
			if kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU
				|| kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU
			{
				let name = std::ffi::CStr::from_ptr(sys::ggml_backend_dev_description(dev))
					.to_string_lossy()
					.into_owned();
				gpus.push((kind, name));
			}
		}
	}
	// whisper.cpp counts GPU and integrated GPU devices together, in registry order
	let Some(index) = gpus
		.iter()
		.position(|(kind, _)| *kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU)
		.or(if gpus.is_empty() { None } else { Some(0) })
	else {
		return Ok(None);
	};
	Ok(Some(Device {
		index: index as i32,
		name: gpus.swap_remove(index).1,
	}))
}

/// The GPU transcription will run on, or None for the CPU
#[tauri::command]
pub async fn gpu_device(app: AppHandle) -> Result<Option<String>, String> {
	tauri::async_runtime::spawn_blocking(move || Ok(prepare(&app)?.map(|d| d.name)))
		.await
		.map_err(|e| e.to_string())?
}
