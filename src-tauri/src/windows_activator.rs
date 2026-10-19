//! Windows activation listener, context capture, and permissions.
//!
//! This module combines the Windows-specific functionality needed for QuickAI:
//! - Double-tap summon-key detection via SetWindowsHookExW (the key comes from
//!   the `[general].hotkey` setting)
//! - Context capture (clipboard fallback for selected text)
//! - Permission stubs (Windows has no TCC equivalent)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_TYPE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_C,
    VK_CONTROL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetCursorPos, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
};

use crate::config::Hotkey;
use crate::context::{ActivationContext, ScreenRect};

use windows::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GetWindowRect, GUITHREADINFO};

// ─── Constants ──────────────────────────────────────────────────────────────────

/// Maximum gap between the two taps of a double-tap.
///
/// There is deliberately **no** cooldown on top of this. A cooldown can only
/// ever *block* a legitimate double-tap: it cannot stop one physical double-tap
/// from firing twice, because firing clears `last_trigger` so the next press
/// starts a fresh sequence, and key auto-repeat is already absorbed by
/// `is_pressed`. The previous 600 ms cooldown did exactly that harm — it
/// returned early *after* setting `is_pressed` and without recording
/// `last_trigger`, so the first tap of a follow-up double-tap was consumed and
/// the user needed an extra press.
const ACTIVATION_WINDOW: Duration = Duration::from_millis(400);

// Left/right virtual-key codes for each selectable summon key. Both sides of
// the modifier count, so a double-tap of either physical key activates.
const VK_LCONTROL: i32 = 0xA2;
const VK_RCONTROL: i32 = 0xA3;
const VK_LMENU: i32 = 0xA4;
const VK_RMENU: i32 = 0xA5;
const VK_LSHIFT: i32 = 0xA0;
const VK_RSHIFT: i32 = 0xA1;
const VK_LWIN: i32 = 0x5B;
const VK_RWIN: i32 = 0x5C;

/// Maps a configured hotkey to its `(left, right)` virtual-key codes.
pub fn hotkey_vk_codes(hotkey: Hotkey) -> (i32, i32) {
    match hotkey {
        Hotkey::Ctrl => (VK_LCONTROL, VK_RCONTROL),
        Hotkey::Alt => (VK_LMENU, VK_RMENU),
        Hotkey::Shift => (VK_LSHIFT, VK_RSHIFT),
        Hotkey::Win => (VK_LWIN, VK_RWIN),
    }
}

/// Applies the configured summon key to the keyboard hook. Called at startup
/// and whenever `[general].hotkey` changes; the hook reads the pair on every
/// key event, so the change takes effect immediately.
pub fn apply_hotkey(hotkey: Hotkey) {
    *GLOBAL_HOTKEY_VKS.lock().unwrap() = hotkey_vk_codes(hotkey);
}

// ─── Global Hook State ─────────────────────────────────────────────────────────

/// Left/right virtual-key pair that triggers activation (default: Ctrl).
static GLOBAL_HOTKEY_VKS: LazyLock<Mutex<(i32, i32)>> =
    LazyLock::new(|| Mutex::new(hotkey_vk_codes(Hotkey::Ctrl)));

static GLOBAL_ACTIVATION_STATE: LazyLock<Mutex<ActivationState>> = LazyLock::new(|| {
    Mutex::new(ActivationState {
        last_trigger: None,
        is_pressed: false,
    })
});

type ActivationCallback = Arc<dyn Fn() + Send + Sync>;

#[allow(clippy::type_complexity)]
static GLOBAL_ON_ACTIVATION: LazyLock<Mutex<Option<ActivationCallback>>> =
    LazyLock::new(|| Mutex::new(None));

static GLOBAL_HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);

// ─── Activation Logic ──────────────────────────────────────────────────────────

struct ActivationState {
    /// When the first tap of the current double-tap sequence was seen, if one is
    /// in progress. Cleared when a sequence fires, so a single physical
    /// double-tap can never fire twice.
    last_trigger: Option<Instant>,
    /// Whether the summon key is currently held down. Guards against key
    /// auto-repeat and duplicate key-downs counting as extra taps.
    is_pressed: bool,
}

/// Advances the double-tap state machine on a key transition.
///
/// Returns `true` when the press completes a double-tap. A press is **never**
/// swallowed: one that does not complete a double-tap becomes the first tap of a
/// new sequence, so the next press can complete it. (The old code returned early
/// on a cooldown *without* recording `last_trigger`, which consumed the tap and
/// forced the user into an extra press — item 5.)
fn evaluate_activation(state: &mut ActivationState, is_press: bool) -> bool {
    if !is_press {
        state.is_pressed = false;
        return false;
    }

    if state.is_pressed {
        // Auto-repeat while the key is held, or a duplicate key-down for the
        // press already in progress: not a new tap.
        return false;
    }
    state.is_pressed = true;

    let now = Instant::now();
    let completes_double_tap = state
        .last_trigger
        .is_some_and(|last| now.duration_since(last) < ACTIVATION_WINDOW);

    if completes_double_tap {
        state.last_trigger = None;
        return true;
    }

    state.last_trigger = Some(now);
    false
}

// ─── Public Interface ───────────────────────────────────────────────────────────

pub struct OverlayActivator {
    is_active: Arc<AtomicBool>,
}

impl OverlayActivator {
    pub fn new() -> Self {
        Self {
            is_active: Arc::new(AtomicBool::new(false)),
        }
    }

    #[cfg_attr(coverage_nightly, coverage(off))]
    pub fn start<F>(&self, on_activation: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        if self.is_active.load(Ordering::SeqCst) {
            return;
        }
        self.is_active.store(true, Ordering::SeqCst);

        {
            let mut cb = GLOBAL_ON_ACTIVATION.lock().unwrap();
            *cb = Some(Arc::new(on_activation));
        }

        let is_active = self.is_active.clone();

        std::thread::spawn(move || {
            run_hook_loop(is_active);
        });
    }
}

#[cfg_attr(coverage_nightly, coverage(off))]
fn run_hook_loop(is_active: Arc<AtomicBool>) {
    GLOBAL_HOOK_ACTIVE.store(true, Ordering::SeqCst);

    let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_callback), None, 0) };

    match hook {
        Ok(hook_handle) => {
            eprintln!(
                "quickai: [activator] keyboard hook installed — listening for the double-tap summon key"
            );

            let mut msg = MSG::default();
            while is_active.load(Ordering::SeqCst) {
                let ret = unsafe { GetMessageW(&mut msg, None, 0, 0) };
                if ret == BOOL(0) || ret == BOOL(-1) {
                    break;
                }
            }

            let _ = unsafe { UnhookWindowsHookEx(hook_handle) };
        }
        Err(_) => {
            eprintln!("quickai: [activator] failed to install keyboard hook");
        }
    }

    GLOBAL_HOOK_ACTIVE.store(false, Ordering::SeqCst);

    {
        let mut cb = GLOBAL_ON_ACTIVATION.lock().unwrap();
        *cb = None;
    }

    eprintln!("quickai: [activator] keyboard hook removed");
}

unsafe extern "system" fn keyboard_hook_callback(
    code: i32,
    w_param: WPARAM,
    l_param: LPARAM,
) -> LRESULT {
    if code < 0 {
        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
    }

    let kb_struct = unsafe { &*(l_param.0 as *const KBDLLHOOKSTRUCT) };

    // Ignore synthetic key events (e.g. from SendInput in clipboard_fallback)
    // to prevent simulated Ctrl presses from interfering with activation detection.
    // LLKHF_INJECTED = 0x0010 — set for events injected by SendInput or similar.
    let injected = kb_struct.flags.0 & 0x10 != 0;
    if injected {
        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
    }

    let wparam_val = w_param.0 as u32;
    let is_press = wparam_val == 0x0100 || wparam_val == 0x0104;

    let vk_code = kb_struct.vkCode as i32;

    let (vk_left, vk_right) = *GLOBAL_HOTKEY_VKS.lock().unwrap();
    if vk_code == vk_left || vk_code == vk_right {
        let is_release = wparam_val == 0x0101 || wparam_val == 0x0105;
        let key_down = is_press && !is_release;

        let mut s = GLOBAL_ACTIVATION_STATE.lock().unwrap();
        if evaluate_activation(&mut s, key_down) {
            let cb = GLOBAL_ON_ACTIVATION.lock().unwrap();
            if let Some(ref callback) = *cb {
                callback();
            }
        }
    }

    unsafe { CallNextHookEx(None, code, w_param, l_param) }
}

// ─── Context Capture ────────────────────────────────────────────────────────────

fn current_mouse_position() -> (f64, f64) {
    let mut point = POINT { x: 0, y: 0 };
    unsafe {
        let _ = GetCursorPos(&mut point);
    }
    (point.x as f64, point.y as f64)
}

fn simulate_ctrl_c() {
    let inputs: [INPUT; 4] = [
        INPUT {
            r#type: INPUT_TYPE(1),
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_TYPE(1),
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_C,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_TYPE(1),
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_C,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_TYPE(1),
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn clipboard_text() -> String {
    unsafe {
        if OpenClipboard(None).is_err() {
            return String::new();
        }
        let result = if let Ok(handle) = GetClipboardData(CF_UNICODETEXT.0 as u32) {
            let ptr = handle.0 as *const u16;
            if ptr.is_null() {
                String::new()
            } else {
                let len = (0..).take_while(|&i| *ptr.add(i) != 0).count();
                let slice = std::slice::from_raw_parts(ptr, len);
                String::from_utf16_lossy(slice)
            }
        } else {
            String::new()
        };
        let _ = CloseClipboard();
        result
    }
}

fn write_clipboard(text: &str) {
    unsafe {
        if OpenClipboard(None).is_err() {
            return;
        }
        let _ = EmptyClipboard();
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let size = wide.len() * std::mem::size_of::<u16>();
        if let Ok(h_mem) = GlobalAlloc(GMEM_MOVEABLE, size) {
            let ptr = GlobalLock(h_mem);
            if !ptr.is_null() {
                std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr as *mut u16, wide.len());
                let _ = GlobalUnlock(h_mem);
                let _ = SetClipboardData(
                    CF_UNICODETEXT.0 as u32,
                    Some(windows::Win32::Foundation::HANDLE(h_mem.0)),
                );
            }
        }
        let _ = CloseClipboard();
    }
}

fn clipboard_fallback() -> Option<String> {
    let before = clipboard_text();
    simulate_ctrl_c();

    let mut after = before.clone();
    for delay_ms in [10, 20, 40, 80] {
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        after = clipboard_text();
        if after != before {
            break;
        }
    }

    if after != before {
        write_clipboard(&before);
    }

    let trimmed = after.trim().to_string();
    if after != before && !trimmed.is_empty() {
        Some(trimmed)
    } else {
        None
    }
}

/// Attempts to get the bounding rectangle of the focused UI element.
/// Uses GetGUIThreadInfo to find the focused control and GetWindowRect
/// as a fallback. This provides approximate bounds for window positioning.
fn get_focused_element_bounds() -> Option<ScreenRect> {
    unsafe {
        let mut gui_info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };

        // Get info about the foreground thread's UI state.
        if GetGUIThreadInfo(0, &mut gui_info).is_err() {
            return None;
        }

        // If we have a focused control handle, get its screen rectangle.
        let hwnd = if !gui_info.hwndFocus.is_invalid() && !gui_info.hwndFocus.0.is_null() {
            gui_info.hwndFocus
        } else if !gui_info.hwndActive.is_invalid() && !gui_info.hwndActive.0.is_null() {
            gui_info.hwndActive
        } else {
            return None;
        };

        let mut rect = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            Some(ScreenRect {
                x: rect.left as f64,
                y: rect.top as f64,
                width: (rect.right - rect.left) as f64,
                height: (rect.bottom - rect.top) as f64,
            })
        } else {
            None
        }
    }
}

pub fn capture() -> ActivationContext {
    let mouse = current_mouse_position();
    let text = clipboard_fallback();
    let bounds = get_focused_element_bounds();
    ActivationContext {
        selected_text: text,
        bounds,
        mouse_position: Some(mouse),
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkey_vk_codes_map_every_key() {
        assert_eq!(hotkey_vk_codes(Hotkey::Ctrl), (VK_LCONTROL, VK_RCONTROL));
        assert_eq!(hotkey_vk_codes(Hotkey::Alt), (VK_LMENU, VK_RMENU));
        assert_eq!(hotkey_vk_codes(Hotkey::Shift), (VK_LSHIFT, VK_RSHIFT));
        assert_eq!(hotkey_vk_codes(Hotkey::Win), (VK_LWIN, VK_RWIN));
    }

    #[test]
    fn apply_hotkey_updates_global_pair() {
        apply_hotkey(Hotkey::Alt);
        assert_eq!(*GLOBAL_HOTKEY_VKS.lock().unwrap(), (VK_LMENU, VK_RMENU));

        // Restore the default so later tests observe the documented default.
        apply_hotkey(Hotkey::Ctrl);
        assert_eq!(
            *GLOBAL_HOTKEY_VKS.lock().unwrap(),
            (VK_LCONTROL, VK_RCONTROL)
        );
    }

    #[test]
    fn validates_activation_sequence() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
        };
        assert!(!evaluate_activation(&mut state, true));
        evaluate_activation(&mut state, false);
        assert!(evaluate_activation(&mut state, true));
    }

    #[test]
    fn rejects_stale_sequence() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
        };
        evaluate_activation(&mut state, true);
        evaluate_activation(&mut state, false);
        state.last_trigger = Some(Instant::now() - Duration::from_millis(500));
        assert!(!evaluate_activation(&mut state, true));
    }

    #[test]
    fn boundary_timing_at_exactly_400ms_is_rejected() {
        let mut state = ActivationState {
            last_trigger: Some(Instant::now() - Duration::from_millis(400)),
            is_pressed: false,
        };
        assert!(!evaluate_activation(&mut state, true));
    }

    #[test]
    fn release_without_press_does_nothing() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
        };
        assert!(!evaluate_activation(&mut state, false));
        assert!(state.last_trigger.is_none());
    }

    /// Item 5's mechanism 1: the first tap of a follow-up double-tap must not be
    /// swallowed, so two double-taps in quick succession both fire.
    #[test]
    fn consecutive_double_taps_each_fire_without_a_wasted_press() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
        };
        // First double-tap.
        assert!(!evaluate_activation(&mut state, true));
        evaluate_activation(&mut state, false);
        assert!(evaluate_activation(&mut state, true));
        // Second double-tap immediately after — both presses still count.
        evaluate_activation(&mut state, false);
        assert!(!evaluate_activation(&mut state, true));
        evaluate_activation(&mut state, false);
        assert!(evaluate_activation(&mut state, true));
    }

    /// Auto-repeat while the summon key is held must not register as new taps.
    #[test]
    fn auto_repeat_of_a_held_key_is_ignored() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: false,
        };
        assert!(!evaluate_activation(&mut state, true));
        // The OS delivers repeated key-downs while the key is held; none of them
        // may complete a double-tap on their own.
        assert!(!evaluate_activation(&mut state, true));
        assert!(!evaluate_activation(&mut state, true));
        assert!(state.last_trigger.is_some());
    }

    /// A fired sequence is cleared, so one physical double-tap cannot fire twice
    /// and a fresh sequence starts from the next press.
    #[test]
    fn firing_clears_the_sequence() {
        let mut state = ActivationState {
            last_trigger: Some(Instant::now()),
            is_pressed: false,
        };
        assert!(evaluate_activation(&mut state, true));
        assert!(state.last_trigger.is_none());
        // The same held press cannot fire again.
        assert!(!evaluate_activation(&mut state, true));
        assert!(state.last_trigger.is_none());
    }
}
