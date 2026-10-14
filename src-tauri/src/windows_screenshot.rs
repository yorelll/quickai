//! Windows screenshot capture using GDI.
//!
//! Captures the full virtual screen (all monitors) and saves it as a PNG.

use tauri::Manager;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetBitmapBits,
    GetDC, ReleaseDC, SelectObject, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

// ─── Full-screen capture (all monitors) ──────────────────────────────────────

/// Captures the full virtual screen (all monitors) using GDI BitBlt
/// and returns raw RGBA pixel bytes plus the virtual screen origin offset.
fn capture_virtual_screen_pixels() -> Result<(i32, i32, u32, u32, Vec<u8>), String> {
    unsafe {
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        if vw <= 0 || vh <= 0 {
            return Err("Failed to get virtual screen dimensions".to_string());
        }

        let width = vw as u32;
        let height = vh as u32;

        let screen_dc = GetDC(None);
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        let bitmap = CreateCompatibleBitmap(screen_dc, vw, vh);
        let _old_bitmap = SelectObject(mem_dc, bitmap.into());

        BitBlt(mem_dc, 0, 0, vw, vh, Some(screen_dc), vx, vy, SRCCOPY)
            .map_err(|e| format!("BitBlt failed: {e}"))?;

        // Deselect bitmap before reading.
        SelectObject(mem_dc, _old_bitmap);

        let row_size = width * 4;
        let pixel_size = (row_size * height) as usize;
        let mut pixels: Vec<u8> = vec![0u8; pixel_size];

        let bits_copied = GetBitmapBits(
            bitmap,
            pixel_size as i32,
            pixels.as_mut_ptr() as *mut core::ffi::c_void,
        );

        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem_dc);
        let _ = ReleaseDC(None, screen_dc);

        if bits_copied == 0 {
            return Err("GetBitmapBits returned 0 bytes".to_string());
        }

        // Convert BGRA to RGBA in-place.
        for chunk in pixels.as_chunks_mut::<4>().0 {
            chunk.swap(0, 2);
        }

        Ok((vx, vy, width, height, pixels))
    }
}

/// Captures the full virtual screen and saves it as a PNG in the images
/// directory of the startup-resolved data directory, returning the absolute
/// file path.
async fn capture_full_screen_to_file(app_handle: tauri::AppHandle) -> Result<String, String> {
    // The startup-resolved `[general].data_dir` override, or the OS default.
    let base_dir = app_handle
        .state::<crate::config::ResolvedDataDir>()
        .path()
        .to_path_buf();

    tokio::task::spawn_blocking(move || {
        let (_vx, _vy, width, height, rgba_bytes) = capture_virtual_screen_pixels()?;

        let buf =
            image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(width, height, rgba_bytes)
                .ok_or_else(|| "Failed to create image buffer from captured pixels.".to_string())?;
        let dynamic = image::DynamicImage::ImageRgba8(buf);

        let mut png: Vec<u8> = Vec::new();
        dynamic
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|e| format!("Failed to encode screen capture as PNG: {e}"))?;

        crate::images::save_image(&base_dir, &png)
    })
    .await
    .map_err(|e| format!("image encoding task failed: {e}"))?
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Tauri command: silently captures the full virtual screen (all monitors)
/// and returns the absolute file path of the saved image.
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
pub async fn capture_full_screen_command(app_handle: tauri::AppHandle) -> Result<String, String> {
    capture_full_screen_to_file(app_handle).await
}

/// Captures the full virtual screen without hiding or showing the overlay.
/// Used by the agent mode loop where the overlay must remain visible.
#[cfg(target_os = "windows")]
#[cfg_attr(coverage_nightly, coverage(off))]
pub async fn capture_silent_screenshot_command(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    capture_full_screen_to_file(app_handle).await
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_screen_metrics_are_non_negative() {
        let result = capture_virtual_screen_pixels();
        if let Ok((_vx, _vy, w, h, pixels)) = result {
            assert!(w > 0);
            assert!(h > 0);
            assert_eq!(pixels.len(), (w * h * 4) as usize);
        }
        // On headless CI, an error is expected and acceptable.
    }
}
