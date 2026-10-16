//! Window focus change detection for minibar mode.
//!
//! Uses `SetWinEventHook` with `EVENT_SYSTEM_FOREGROUND` to detect
//! when the user switches away from QuickAI, triggering minibar mode.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::EVENT_SYSTEM_FOREGROUND;

/// WINEVENT_OUTOFCONTEXT = 0x0000 — hook callback is not in-context.
const WINEVENT_OUTOFCONTEXT: u32 = 0;

/// Whether the minibar mode is currently active.
static MINIBAR_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Whether the overlay is pinned open. While pinned, losing focus does not
/// shrink the overlay to the minibar (item 17).
static OVERLAY_PINNED: AtomicBool = AtomicBool::new(false);

/// Returns whether the minibar is currently active.
pub fn is_minibar_active() -> bool {
    MINIBAR_ACTIVE.load(Ordering::SeqCst)
}

/// Returns whether the overlay is pinned open.
pub fn is_pinned() -> bool {
    OVERLAY_PINNED.load(Ordering::SeqCst)
}

/// Sets the pinned state. Idempotent — the frontend re-sends the current value
/// on every overlay open to stay in sync.
pub fn set_pinned(pinned: bool) {
    OVERLAY_PINNED.store(pinned, Ordering::SeqCst);
}

/// Pure decision: whether losing focus should shrink the overlay to the
/// minibar.
///
/// Suppressed in two cases: the overlay is pinned open (the user pinned it
/// precisely so that clicking outside would not hide it), or it is already in
/// minibar (the transition is one-way until the user restores it).
fn should_enter_minibar(pinned: bool, minibar_active: bool) -> bool {
    !pinned && !minibar_active
}

/// Whether losing focus should shrink the overlay to the minibar, for the
/// current state. Every place that installs the focus listener uses this so the
/// two guards cannot drift apart.
pub fn should_enter_minibar_on_focus_loss() -> bool {
    should_enter_minibar(is_pinned(), is_minibar_active())
}

/// Enters minibar mode — shrinks the overlay to a thin always-on-top strip.
pub fn enter_minibar() -> bool {
    MINIBAR_ACTIVE.store(true, Ordering::SeqCst);
    true
}

/// Exits minibar mode — restores the overlay to full size.
pub fn exit_minibar() -> bool {
    MINIBAR_ACTIVE.store(false, Ordering::SeqCst);
    false
}

/// Applies the `WS_EX_TOOLWINDOW` extended style to `hwnd`, durably keeping the
/// window out of the taskbar.
///
/// Tauri's `set_skip_taskbar(true)` is not durable on Windows: tao implements it
/// as a one-shot `ITaskbarList::DeleteTab`, which the shell can undo when it next
/// re-evaluates the window (the reappearing-taskbar-button bug). `WS_EX_TOOLWINDOW`
/// is a window style the shell honours on every re-evaluation, so it is the
/// reliable fix; `skip_taskbar` is kept alongside it as belt and braces.
///
/// Removing the window from Alt+Tab is **intended**, not a side effect: these are
/// overlay-style windows the app already hides from the taskbar, and a tool
/// window is the correct shell classification for them.
///
/// Best-effort and native-only: there is nothing to unit-test (it needs a live
/// HWND), so it is coverage-excluded. A failure leaves the caller's
/// `set_skip_taskbar` in place.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn apply_tool_window_style(hwnd: HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_TOOLWINDOW,
    };

    unsafe {
        // A zero read means the query failed (a real window always has some
        // extended style). Bail out rather than OR-ing onto 0: `SetWindowLongPtrW`
        // would then *replace* the window's real extended styles instead of
        // adding to them. Skipping is the safe choice — the caller keeps its
        // `set_skip_taskbar` in place.
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style == 0 {
            return;
        }
        let with_tool_window = style | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, with_tool_window);
        // SWP_FRAMECHANGED makes the shell re-read the extended style;
        // NOMOVE/NOSIZE/NOZORDER leave geometry and stacking untouched.
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
}

/// Focus change callback type. Receives the HWND of the newly focused window.
type FocusChangeCallback = Arc<dyn Fn(HWND) + Send + Sync>;

/// Global state for the focus change hook.
static mut FOCUS_CALLBACK: Option<FocusChangeCallback> = None;
static mut FOCUS_HOOK: Option<HWINEVENTHOOK> = None;

/// HWND of the main QuickAI window, used to filter self-focus events.
static mut MAIN_HWND: Option<HWND> = None;

/// Stores the main window HWND so the callback can filter self-focus events.
pub fn set_main_hwnd(hwnd: HWND) {
    unsafe {
        MAIN_HWND = Some(hwnd);
    }
}

/// The WinEvent hook callback.
#[allow(static_mut_refs)]
unsafe extern "system" fn focus_event_callback(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    // OBJID_WINDOW = 0
    if id_object != 0 {
        return;
    }

    // Skip if the focused window IS QuickAI (user clicked back on us).
    if let Some(main_hwnd) = MAIN_HWND {
        if hwnd == main_hwnd {
            return;
        }
    }

    if let Some(callback) = FOCUS_CALLBACK.as_ref() {
        callback(hwnd);
    }
}

/// Starts listening for window focus changes.
/// When a different window gets focus, the callback is invoked with that window's HWND.
#[allow(static_mut_refs)]
pub fn start_focus_listener(callback: FocusChangeCallback) -> Result<(), String> {
    unsafe {
        FOCUS_CALLBACK = Some(callback);

        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(focus_event_callback),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );

        if hook.0.is_null() {
            return Err("SetWinEventHook returned null hook".to_string());
        }

        FOCUS_HOOK = Some(hook);
    }

    Ok(())
}

/// Stops the focus change listener.
#[allow(static_mut_refs)]
pub fn stop_focus_listener() -> Result<(), String> {
    unsafe {
        if let Some(hook) = FOCUS_HOOK.take() {
            let _ = UnhookWinEvent(hook);
        }
        FOCUS_CALLBACK = None;
    }
    Ok(())
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minibar_starts_inactive() {
        assert!(!is_minibar_active());
    }

    #[test]
    fn set_pinned_round_trips_and_is_idempotent() {
        set_pinned(true);
        assert!(is_pinned());
        set_pinned(true); // Idempotent.
        assert!(is_pinned());
        set_pinned(false);
        assert!(!is_pinned());
        set_pinned(false); // Idempotent.
        assert!(!is_pinned());
    }

    #[test]
    fn focus_loss_minibar_decision() {
        // Pinning suppresses the click-away transition.
        assert!(!should_enter_minibar(true, false));
        // Already in minibar: the transition is one-way until restored.
        assert!(!should_enter_minibar(false, true));
        // Pinned while already in minibar is still suppressed.
        assert!(!should_enter_minibar(true, true));
        // Neither guard set: the normal click-away behaviour.
        assert!(should_enter_minibar(false, false));
    }

    #[test]
    fn enter_minibar_sets_active() {
        MINIBAR_ACTIVE.store(false, Ordering::SeqCst);
        let result = enter_minibar();
        assert!(result);
        assert!(is_minibar_active());
        // Reset
        MINIBAR_ACTIVE.store(false, Ordering::SeqCst);
    }

    #[test]
    fn exit_minibar_sets_inactive() {
        MINIBAR_ACTIVE.store(true, Ordering::SeqCst);
        let result = exit_minibar();
        assert!(!result);
        assert!(!is_minibar_active());
    }

    #[test]
    fn minibar_roundtrip() {
        MINIBAR_ACTIVE.store(false, Ordering::SeqCst);
        assert!(!is_minibar_active());
        enter_minibar();
        assert!(is_minibar_active());
        exit_minibar();
        assert!(!is_minibar_active());
    }

    #[test]
    fn set_main_hwnd_stores_value() {
        let test_hwnd = HWND(std::ptr::null_mut());
        set_main_hwnd(test_hwnd);
        unsafe {
            // Copy the value out rather than taking a reference to the
            // mutable static.
            let stored = MAIN_HWND;
            assert!(stored.is_some());
        }
        // Reset
        unsafe {
            MAIN_HWND = None;
        }
    }
}
