mod asr;
mod gpu;
mod jobs;
mod media;
mod models;
mod youtube;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_opener::init())
		.manage(jobs::Jobs::default())
		.manage(youtube::YouTube::default())
		.invoke_handler(tauri::generate_handler![
			media::media_peaks,
			gpu::gpu_device,
			models::models_installed,
			models::model_download,
			models::model_delete,
			asr::transcribe,
			jobs::job_cancel,
			youtube::youtube_available,
			youtube::youtube_account,
			youtube::youtube_sign_in,
			youtube::youtube_cancel_sign_in,
			youtube::youtube_sign_out,
			youtube::youtube_videos,
			youtube::youtube_video,
			youtube::youtube_captions,
			youtube::youtube_upload,
			youtube::youtube_delete_caption,
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
		.run(tauri::generate_context!())
		.expect("error while building tauri application");
}
