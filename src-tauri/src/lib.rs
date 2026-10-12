mod asr;
mod gpu;
mod jobs;
mod launch;
mod media;
mod media_server;
mod models;
mod speakers;
mod youtube;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	launch::from_args();

	let app = tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_opener::init())
		.manage(jobs::Jobs::default())
		.manage(youtube::YouTube::default())
		.invoke_handler(tauri::generate_handler![
			media::media_peaks,
			media_server::media_server,
			gpu::gpu_device,
			models::models_installed,
			speakers::speakers_installed,
			speakers::speakers_download,
			speakers::diarize,
			models::model_download,
			models::model_delete,
			asr::transcribe,
			jobs::job_cancel,
			launch::launch_file,
			youtube::youtube_available,
			youtube::youtube_account,
			youtube::youtube_sign_in,
			youtube::youtube_cancel_sign_in,
			youtube::youtube_sign_out,
			youtube::youtube_videos,
			youtube::youtube_video,
			youtube::youtube_captions,
			youtube::youtube_upload,
		])
		.setup(|app| {
			if cfg!(debug_assertions) {
				app.handle().plugin(
					tauri_plugin_log::Builder::default()
						.level(log::LevelFilter::Info)
						.build(),
				)?;
			}
			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(|_app, _event| {
		#[cfg(target_os = "macos")]
		if let tauri::RunEvent::Opened { urls } = _event {
			for url in urls {
				if let Ok(path) = url.to_file_path() {
					launch::opened(_app, path.to_string_lossy().into_owned());
				}
			}
		}
	});
}
