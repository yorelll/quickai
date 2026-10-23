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
    // The replacement process starts while this one still holds the
    // single-instance mutex and is about to exit. Mark the hand-over so the
    // child takes the kernel objects over instead of forwarding to — and
    // exiting behind — the dying parent.
    crate::single_instance::mark_relaunch();
    // `restart` exits without running destructors; flush first so the trace
    // ends with the relaunch instead of losing the tail.
    crate::diagnostics::flush();
    app_handle.restart();
}
