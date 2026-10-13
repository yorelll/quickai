//! Windows lifecycle commands.
//!
//! QuickAI is Windows-only and has no permission gate, so the only command
//! that lives here is the app relaunch used to finish onboarding.

/// Restarts the application. On Windows, this updates the onboarding stage
/// before restarting.
#[tauri::command]
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn quit_and_relaunch(app_handle: tauri::AppHandle, db: tauri::State<crate::history::Database>) {
    if let Ok(conn) = db.0.lock() {
        let _ = crate::onboarding::set_stage(&conn, &crate::onboarding::OnboardingStage::Intro);
    }
    app_handle.restart();
}
