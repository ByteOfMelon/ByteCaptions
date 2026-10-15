//! Auto-update support the updater plugin doesn't cover

/// Whether this copy can update itself. On Linux only the AppImage can do so
#[tauri::command]
pub fn can_self_update() -> bool {
	cfg!(not(target_os = "linux")) || std::env::var_os("APPIMAGE").is_some()
}
