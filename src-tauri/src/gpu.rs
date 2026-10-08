//! GPU acceleration for whisper.cpp through Vulkan, with the CPU as the fallback.
//!
//! The Windows build links the Vulkan loader (vulkan-1.dll) delay-loaded (build.rs), so the
//! app starts without one. Before whisper.cpp first runs, `prepare` makes sure a loader is in
//! the process: the system's (GPU drivers install it) or, failing that, the copy bundled with
//! the app. With a loader but no usable GPU, whisper.cpp finds no Vulkan device and runs on
//! the CPU.

use tauri::AppHandle;

/// The device to transcribe on, as whisper.cpp's `gpu_device` index and a display name, or
/// None for the CPU.
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
	// SAFETY: loads a DLL; the handle is kept for the life of the process.
	let load = |path: &std::ffi::OsStr, flags: u32| {
		let wide: Vec<u16> = path.encode_wide().chain([0]).collect();
		!unsafe { LoadLibraryExW(wide.as_ptr(), std::ptr::null_mut(), flags) }.is_null()
	};

	static LOADED: OnceLock<Result<(), String>> = OnceLock::new();
	LOADED
		.get_or_init(|| {
			if load("vulkan-1.dll".as_ref(), LOAD_LIBRARY_SEARCH_SYSTEM32) {
				return Ok(());
			}
			let bundled = app
				.path()
				.resource_dir()
				.map_err(|e| e.to_string())?
				.join("vulkan")
				.join("vulkan-1.dll");
			if load(bundled.as_os_str(), LOAD_WITH_ALTERED_SEARCH_PATH) {
				Ok(())
			} else {
				// whisper.cpp would crash resolving its delay-loaded Vulkan import.
				Err("A file transcription needs is missing (vulkan-1.dll). Reinstalling ByteCaptions should fix it.".into())
			}
		})
		.clone()
}

#[cfg(not(windows))]
fn ensure_loader(_app: &AppHandle) -> Result<(), String> {
	Ok(())
}

/// Get whisper.cpp ready to use the GPU and pick the device: the first dedicated GPU, else an
/// integrated one, else None for the CPU. (whisper.cpp would otherwise take the first one Vulkan lists,
/// which on many PCs is the processor's integrated graphics.)
pub fn prepare(app: &AppHandle) -> Result<Option<Device>, String> {
	ensure_loader(app)?;
	use whisper_rs::whisper_rs_sys as sys;
	let mut gpus = Vec::new();
	// SAFETY: plain queries of ggml's device registry (initialized on first use).
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
	// whisper.cpp counts GPU and integrated GPU devices together, in registry order.
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

/// The GPU transcription will run on, by name, or None when it'll use the CPU.
#[tauri::command]
pub async fn gpu_device(app: AppHandle) -> Result<Option<String>, String> {
	tauri::async_runtime::spawn_blocking(move || Ok(prepare(&app)?.map(|d| d.name)))
		.await
		.map_err(|e| e.to_string())?
}
