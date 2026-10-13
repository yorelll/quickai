/*!
 * Screenshot capture command surface.
 *
 * Exposes the `capture_full_screen_command` Tauri command on Windows,
 * delegating to `windows_screenshot`: it silently captures all screens and
 * returns the absolute file path of the saved image.
 */

// ─── Windows screenshot commands ────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub async fn capture_full_screen_command(app_handle: tauri::AppHandle) -> Result<String, String> {
    crate::windows_screenshot::capture_full_screen_command(app_handle).await
}
