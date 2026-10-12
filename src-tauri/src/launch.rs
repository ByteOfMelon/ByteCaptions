//! The project file the app was opened with, e.g. by double-clicking a .bcproj

use std::sync::Mutex;

static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// Takes the project file from the command line
pub fn from_args() {
	let path = std::env::args().skip(1).find(|a| is_project(a));
	*PENDING.lock().unwrap() = path;
}

/// for macOS - a project opened while the app starts up or is already running
#[cfg(target_os = "macos")]
pub fn opened(app: &tauri::AppHandle, path: String) {
	use tauri::Emitter;

	if !is_project(&path) {
		return;
	}
	*PENDING.lock().unwrap() = Some(path.clone());

	let _ = app.emit("launch-file", ());
}

fn is_project(path: &str) -> bool {
	path.to_ascii_lowercase().ends_with(".bcproj")
}

/// The project file to open
#[tauri::command]
pub fn launch_file() -> Option<String> {
	PENDING.lock().unwrap().take()
}
