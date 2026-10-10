//! Cancellation for long jobs. Only one runs at a time, so a single flag is enough

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::State;

#[derive(Default)]
pub struct Jobs {
	cancel: Arc<AtomicBool>,
}

impl Jobs {
	/// Start a job: returns the flag it should poll
	pub fn start(&self) -> Arc<AtomicBool> {
		self.cancel.store(false, Ordering::SeqCst);
		self.cancel.clone()
	}
}

/// Error message for a job stopped by the user; the frontend maps it to an AbortError
pub const CANCELLED: &str = "Cancelled";

#[tauri::command]
pub fn job_cancel(jobs: State<'_, Jobs>) {
	jobs.cancel.store(true, Ordering::SeqCst);
}
