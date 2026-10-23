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
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_TYPE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, VK_C, VK_CONTROL,
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

/// How long the summon key may go without a single event while still marked
/// pressed before `is_pressed` is treated as stale and cleared.
///
/// A key that is genuinely held delivers auto-repeat key-downs every few tens
/// of milliseconds, and Windows' *initial* repeat delay is at most one second
/// (`KeyboardDelay=3`). 1200 ms is therefore unreachable for a held key, while
/// the recorded failure (0.0.7 log) left the flag stuck for 4.4 s. A stale flag
/// must never outlive the situation that caused it, so this is a second,
/// physical-state-independent self-heal next to `StalePhysical`.
///
/// It is evaluated lazily on the next key event rather than by a timer:
/// nothing outside this state machine reads `is_pressed`, so there is no
/// observer that could see the flag during the silence.
const STALE_PRESS_TIMEOUT: Duration = Duration::from_millis(1200);

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

/// The virtual-key pair the hook is currently matching.
///
/// Diagnostics only: the startup banner logs this so it can be compared with
/// the `vk=` values in the `[activator]` lines. A mismatch (e.g. after a
/// config reset, or if `apply_hotkey` never ran) is then visible instead of
/// being inferred from missing log lines.
pub fn active_hotkey_vk_codes() -> (i32, i32) {
    *GLOBAL_HOTKEY_VKS.lock().unwrap()
}

// ─── Global Hook State ─────────────────────────────────────────────────────────

/// Left/right virtual-key pair that triggers activation (default: Ctrl).
static GLOBAL_HOTKEY_VKS: LazyLock<Mutex<(i32, i32)>> =
    LazyLock::new(|| Mutex::new(hotkey_vk_codes(Hotkey::Ctrl)));

static GLOBAL_ACTIVATION_STATE: LazyLock<Mutex<ActivationState>> = LazyLock::new(|| {
    Mutex::new(ActivationState {
        last_trigger: None,
        is_pressed: false,
        last_event: None,
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
    ///
    /// **Self-healing.** This flag is only as good as the hook's view of the
    /// keyboard, and that view can miss a key-up — the 0.0.7 log shows the
    /// release after every firing press was never delivered to the hook. A
    /// stuck flag swallowed the first press of the next gesture (treated as
    /// auto-repeat, so `last_trigger` was not recorded and the whole gesture
    /// was void). It is therefore never trusted on its own: every key-down
    /// re-checks it against the physical key and against the silence since the
    /// previous event (see [`classify_press`]).
    is_pressed: bool,
    /// When any summon-key event (down or up) was last seen. This is the
    /// silence [`PressDecision::StaleTimeout`] measures; auto-repeat keeps it
    /// short while a key is held.
    last_event: Option<Instant>,
}

/// What one key-down means once the recorded flag has been checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PressDecision {
    /// Nothing was marked pressed: an ordinary new tap.
    Fresh,
    /// `is_pressed` was set but the key is physically up, so its key-up was
    /// never delivered. The press is a new tap, not an auto-repeat.
    StalePhysical,
    /// `is_pressed` was set and no event for this key has been seen for
    /// [`STALE_PRESS_TIMEOUT`]. A held key cannot be that quiet, so the flag is
    /// stale even if the physical query cannot confirm it.
    StaleTimeout,
    /// The key really is held down: auto-repeat, not a new tap.
    AutoRepeat,
}

/// Pure decision for a key-down: fresh tap, healed stale flag, or auto-repeat.
///
/// `physical_down` comes from `GetAsyncKeyState` at the moment of the key-down.
/// **This works because the callback runs before the asynchronous key state is
/// updated** — Microsoft documents exactly that on `LowLevelKeyboardProc`
/// ("the asynchronous state of the key cannot be determined by calling
/// `GetAsyncKeyState` from within the hook procedure"). The query therefore
/// returns the **pre-event** state:
///
/// - every auto-repeat reads *down*, because the key has been physically down
///   since the original press;
/// - the first press after a lost release reads *up*, because the physical
///   release happened while our flag still said pressed.
///
/// Do not "simplify" this away by moving the query out of the hook procedure
/// or by assuming it sees the post-event state: the pre-event ordering is the
/// load-bearing premise. The timeout covers the case where the query cannot
/// tell the two apart: a key held for [`STALE_PRESS_TIMEOUT`] without a single
/// event is not held.
fn classify_press(is_pressed: bool, physical_down: bool, idle: Option<Duration>) -> PressDecision {
    if !is_pressed {
        return PressDecision::Fresh;
    }
    if !physical_down {
        return PressDecision::StalePhysical;
    }
    if idle.is_some_and(|idle| idle >= STALE_PRESS_TIMEOUT) {
        return PressDecision::StaleTimeout;
    }
    PressDecision::AutoRepeat
}

/// What one key event produced, for the diagnostic log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ActivationOutcome {
    fired: bool,
    /// Only key-downs carry a decision; key-ups are `None`.
    decision: Option<PressDecision>,
}

/// Advances the double-tap state machine on a key transition.
///
/// Returns `fired: true` when the press completes a double-tap. A press is
/// **never** swallowed: one that does not complete a double-tap becomes the
/// first tap of a new sequence, so the next press can complete it. (The old code
/// returned early on a cooldown *without* recording `last_trigger`, which
/// consumed the tap and forced the user into an extra press — item 5.)
///
/// A press is also never swallowed because of a stale `is_pressed`: when
/// [`classify_press`] reports one of the stale variants, the flag is replaced
/// by this press and the press starts a new sequence exactly as a fresh one
/// would. That is the fix for the 0.0.7 trace, where a lost key-up made the
/// first press of the next gesture a no-op and the user needed four presses.
fn evaluate_activation(
    state: &mut ActivationState,
    is_press: bool,
    physical_down: bool,
) -> ActivationOutcome {
    let now = Instant::now();
    let idle = state.last_event.map(|last| now.duration_since(last));
    // Recorded for both directions: a key-up also ends a silence.
    state.last_event = Some(now);

    if !is_press {
        state.is_pressed = false;
        return ActivationOutcome {
            fired: false,
            decision: None,
        };
    }

    let decision = classify_press(state.is_pressed, physical_down, idle);
    if decision == PressDecision::AutoRepeat {
        // Auto-repeat while the key is held, or a duplicate key-down for the
        // press already in progress: not a new tap.
        return ActivationOutcome {
            fired: false,
            decision: Some(decision),
        };
    }

    // `Fresh`, `StalePhysical` and `StaleTimeout` all reach here: this press is
    // a new tap, and a stale flag is overwritten rather than trusted.
    state.is_pressed = true;

    if state
        .last_trigger
        .is_some_and(|last| now.duration_since(last) < ACTIVATION_WINDOW)
    {
        state.last_trigger = None;
        return ActivationOutcome {
            fired: true,
            decision: Some(decision),
        };
    }

    state.last_trigger = Some(now);
    ActivationOutcome {
        fired: false,
        decision: Some(decision),
    }
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

    let thread = std::thread::current().id();
    let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_callback), None, 0) };

    match hook {
        Ok(hook_handle) => {
            // Lifecycle diagnostic (batch 8): one line per install and one per
            // removal, with the hook handle and the installing thread, so the
            // next trace can prove whether a summon unhooked or reinstalled the
            // hook. Nothing in this process does either — there is exactly one
            // install (here) and one unhook (on loop exit) — so a second
            // `installed` line, or any `uninstalled` line before shutdown,
            // refutes the code as written.
            crate::diag!(
                "quickai: [activator] hook installed reason=start hook={:?} thread={thread:?}",
                hook_handle.0
            );

            let mut msg = MSG::default();
            let reason;
            loop {
                if !is_active.load(Ordering::SeqCst) {
                    reason = "is_active=false";
                    break;
                }
                let ret = unsafe { GetMessageW(&mut msg, None, 0, 0) };
                if ret == BOOL(0) {
                    reason = "getmessage-wmquit";
                    break;
                }
                if ret == BOOL(-1) {
                    reason = "getmessage-error";
                    break;
                }
            }

            let unhooked = unsafe { UnhookWindowsHookEx(hook_handle) };
            crate::diag!(
                "quickai: [activator] hook uninstalled reason={reason} unhook_ok={} hook={:?} thread={thread:?}",
                unhooked.is_ok(),
                hook_handle.0
            );
        }
        Err(e) => {
            crate::diag!(
                "quickai: [activator] hook install failed reason=setwindowshookex error={e} thread={thread:?}"
            );
        }
    }

    GLOBAL_HOOK_ACTIVE.store(false, Ordering::SeqCst);

    {
        let mut cb = GLOBAL_ON_ACTIVATION.lock().unwrap();
        *cb = None;
    }
}

unsafe extern "system" fn keyboard_hook_callback(
    code: i32,
    w_param: WPARAM,
    l_param: LPARAM,
) -> LRESULT {
    if code < 0 {
        // Rare, and otherwise invisible: a negative nCode requires the hook to
        // pass the message on untouched. A run of these would look exactly like
        // "the gesture never reached the hook", so it is logged rather than
        // silently returned.
        crate::diag!("quickai: [activator] hook skipped code={code} (negative nCode)");
        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
    }

    let kb_struct = unsafe { &*(l_param.0 as *const KBDLLHOOKSTRUCT) };

    let vk_code = kb_struct.vkCode as i32;
    let (vk_left, vk_right) = *GLOBAL_HOTKEY_VKS.lock().unwrap();
    let is_summon_key = vk_code == vk_left || vk_code == vk_right;

    // Ignore synthetic key events (e.g. from SendInput in clipboard_fallback)
    // to prevent simulated Ctrl presses from interfering with activation detection.
    // LLKHF_INJECTED = 0x0010 — set for events injected by SendInput or similar.
    let injected = kb_struct.flags.0 & 0x10 != 0;
    if injected {
        // Diagnostic (batch 8): a *synthetic* release of the summon key would
        // be invisible otherwise, and one is a candidate explanation for the
        // 0.0.7 trace (a key-up that never reached the gesture state). Seeing
        // one here right after a firing press would name that cause; seeing
        // none, with the next press logging `physical=Some(false)`, proves the
        // release happened and only the hook's delivery of it was lost.
        if is_summon_key {
            let key_down = matches!(w_param.0 as u32, 0x0100 | 0x0104);
            crate::diag!(
                "quickai: [activator] key vk=0x{vk_code:02X} down={key_down} injected=true ignored"
            );
        }
        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
    }

    let wparam_val = w_param.0 as u32;
    let is_press = wparam_val == 0x0100 || wparam_val == 0x0104;

    if is_summon_key {
        let is_release = wparam_val == 0x0101 || wparam_val == 0x0105;
        let key_down = is_press && !is_release;

        // Diagnostic (batch 8): `physical` is the real key state at this
        // instant (only queried on a key-down, so key-ups log None), `idle` is
        // the silence since the previous event for this key, and `decision`
        // names what the self-heal concluded. A key-up that the hook never saw
        // shows up here as `held=true ... physical=Some(false)
        // decision=StalePhysical` on the next press — the exact 0.0.7 failure,
        // now healed instead of swallowing the tap. This only observes; the
        // predicate is `evaluate_activation`.
        //
        // Recorded residual: a release swallowed by an *earlier* low-level hook
        // in the chain (another process's hook returning non-zero) is
        // indistinguishable, from inside this process, from "the OS never
        // delivered it". No line emitted here can tell those two apart; that
        // ambiguity lives outside the process and is not something this module
        // can resolve.
        let fired = {
            let mut s = GLOBAL_ACTIVATION_STATE.lock().unwrap();
            let held = s.is_pressed;
            let idle = s.last_event.map(|last| last.elapsed());
            let gap = s.last_trigger.map(|first| first.elapsed());
            let physical = if key_down {
                Some(unsafe { GetAsyncKeyState(vk_code) < 0 })
            } else {
                None
            };
            let outcome = evaluate_activation(&mut s, key_down, physical.unwrap_or(false));
            crate::diag!(
                "quickai: [activator] key vk=0x{vk_code:02X} down={key_down} held={held} physical={physical:?} idle={idle:?} gap={gap:?} decision={:?} fired={}",
                outcome.decision,
                outcome.fired
            );
            outcome.fired
        };
        // The state lock is released before the callback runs. `callback()`
        // still executes synchronously on this hook thread (it spawns the
        // capture thread and posts to the main thread), so this only keeps the
        // gesture state out of its critical path — there is no concurrent
        // waiter for it to help. If the callback ever exceeded the
        // `LowLevelHooksTimeout` budget (documented default 300 ms, maximum
        // 1 s), Windows would remove this hook **silently**: the
        // `hook uninstalled` line in `run_hook_loop` would never print, and the
        // trace would simply stop after a `fired=true`. That is the signature
        // to look for.
        if fired {
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
        // The diagnostic accessor reads the same pair the hook uses.
        assert_eq!(active_hotkey_vk_codes(), (VK_LMENU, VK_RMENU));

        // Restore the default so later tests observe the documented default.
        apply_hotkey(Hotkey::Ctrl);
        assert_eq!(
            *GLOBAL_HOTKEY_VKS.lock().unwrap(),
            (VK_LCONTROL, VK_RCONTROL)
        );
        assert_eq!(active_hotkey_vk_codes(), (VK_LCONTROL, VK_RCONTROL));
    }

    /// A fresh state, as the hook thread starts with it.
    fn fresh_state() -> ActivationState {
        ActivationState {
            last_trigger: None,
            is_pressed: false,
            last_event: None,
        }
    }

    /// A key-down with the key physically down (the normal case).
    fn press(state: &mut ActivationState) -> ActivationOutcome {
        evaluate_activation(state, true, true)
    }

    /// A key-up. `physical_down` is irrelevant on this path.
    fn release(state: &mut ActivationState) -> ActivationOutcome {
        evaluate_activation(state, false, false)
    }

    #[test]
    fn validates_activation_sequence() {
        let mut state = fresh_state();
        assert!(!press(&mut state).fired);
        release(&mut state);
        assert!(press(&mut state).fired);
    }

    #[test]
    fn rejects_stale_sequence() {
        let mut state = fresh_state();
        press(&mut state);
        release(&mut state);
        state.last_trigger = Some(Instant::now() - Duration::from_millis(500));
        assert!(!press(&mut state).fired);
    }

    #[test]
    fn boundary_timing_at_exactly_400ms_is_rejected() {
        let mut state = ActivationState {
            last_trigger: Some(Instant::now() - Duration::from_millis(400)),
            ..fresh_state()
        };
        assert!(!press(&mut state).fired);
    }

    #[test]
    fn release_without_press_does_nothing() {
        let mut state = fresh_state();
        assert!(!release(&mut state).fired);
        assert!(state.last_trigger.is_none());
    }

    // ── classify_press: the self-heal decision, in isolation ───────────────
    //
    // `GetAsyncKeyState` itself cannot be exercised in a unit test (it reads
    // the live keyboard), so the decision is isolated here: the hook reads the
    // physical state and this pure function decides what it means.

    #[test]
    fn a_clear_flag_is_a_fresh_press() {
        // The physical query cannot matter when nothing is marked pressed.
        assert_eq!(classify_press(false, true, None), PressDecision::Fresh);
        assert_eq!(
            classify_press(false, false, Some(Duration::from_millis(5))),
            PressDecision::Fresh
        );
    }

    #[test]
    fn a_genuinely_held_key_is_auto_repeat() {
        // The key has been down since the original press, so the physical
        // query reports down and the silence is one repeat interval.
        assert_eq!(
            classify_press(true, true, Some(Duration::from_millis(30))),
            PressDecision::AutoRepeat
        );
        // Just below the timeout is still a repeat, not a heal.
        assert_eq!(
            classify_press(
                true,
                true,
                Some(STALE_PRESS_TIMEOUT - Duration::from_millis(1))
            ),
            PressDecision::AutoRepeat
        );
    }

    #[test]
    fn a_lost_key_up_is_detected_from_the_physical_state() {
        // `is_pressed` is still set, but the key is physically up: the release
        // never reached the hook. This must be a new tap, not a repeat.
        assert_eq!(
            classify_press(true, false, Some(Duration::from_millis(150))),
            PressDecision::StalePhysical
        );
        // Even with no recorded previous event at all (the first event after a
        // state reset): the flag alone is enough to distrust.
        assert_eq!(
            classify_press(true, false, None),
            PressDecision::StalePhysical
        );
    }

    #[test]
    fn the_timeout_heals_a_flag_the_physical_state_cannot_refute() {
        // If the async key state cannot tell the two apart (it reports down),
        // silence for longer than any auto-repeat delay still proves the flag
        // stale: a held key cannot go quiet for that long.
        assert_eq!(
            classify_press(true, true, Some(STALE_PRESS_TIMEOUT)),
            PressDecision::StaleTimeout
        );
        assert_eq!(
            classify_press(true, true, Some(Duration::from_secs(4))),
            PressDecision::StaleTimeout
        );
    }

    #[test]
    fn the_physical_state_wins_when_both_signals_are_stale() {
        // Named ordering: the direct physical evidence is reported first, so
        // the log line says why the heal was immediate rather than timed.
        assert_eq!(
            classify_press(true, false, Some(STALE_PRESS_TIMEOUT)),
            PressDecision::StalePhysical
        );
    }

    // ── The state machine with the self-heal ───────────────────────────────

    /// The 0.0.7 regression, exactly: the key-up after a firing press is lost,
    /// so the next press arrives with `is_pressed` stuck. That press must be a
    /// new tap — not swallowed — and the gesture must complete with the press
    /// after it, instead of needing four presses.
    #[test]
    fn a_lost_key_up_does_not_swallow_the_next_gesture() {
        let mut state = fresh_state();
        // A normal double-tap fires.
        assert!(!press(&mut state).fired);
        release(&mut state);
        assert!(press(&mut state).fired);
        // Its key-up is lost. The next press arrives with the flag stuck and
        // the key physically down for this new press — but the async state the
        // hook read is up, which is how the heal is chosen.
        let healed = evaluate_activation(&mut state, true, false);
        assert_eq!(healed.decision, Some(PressDecision::StalePhysical));
        assert!(
            !healed.fired,
            "the press starts a sequence, it does not fire"
        );
        // Crucially it counted as the first tap: the gesture is not void.
        assert!(state.last_trigger.is_some());
        assert!(state.is_pressed);
        // The second tap completes it.
        release(&mut state);
        assert!(press(&mut state).fired);
    }

    /// Same guarantee when only the timeout can identify the stale flag: the
    /// press is still recorded as the first tap of a new sequence.
    #[test]
    fn the_timeout_heal_also_records_the_press_as_a_tap() {
        let mut state = ActivationState {
            last_trigger: None,
            is_pressed: true,
            last_event: Some(Instant::now() - Duration::from_millis(1500)),
        };
        let healed = press(&mut state);
        assert_eq!(healed.decision, Some(PressDecision::StaleTimeout));
        assert!(!healed.fired);
        assert!(state.last_trigger.is_some());
        release(&mut state);
        assert!(press(&mut state).fired);
    }

    /// A genuinely held key does not fire, however long it is held: every
    /// auto-repeat is recognised while the key is physically down and the
    /// events keep coming.
    #[test]
    fn a_held_key_never_fires() {
        let mut state = fresh_state();
        assert!(!press(&mut state).fired);
        let first_tap = state.last_trigger;
        for _ in 0..50 {
            let repeat = press(&mut state);
            assert_eq!(repeat.decision, Some(PressDecision::AutoRepeat));
            assert!(!repeat.fired);
        }
        // Repeats did not overwrite the sequence's first tap.
        assert_eq!(state.last_trigger, first_tap);
    }

    /// Item 5's mechanism 1: the first tap of a follow-up double-tap must not be
    /// swallowed, so two double-taps in quick succession both fire.
    #[test]
    fn consecutive_double_taps_each_fire_without_a_wasted_press() {
        let mut state = fresh_state();
        // First double-tap.
        assert!(!press(&mut state).fired);
        release(&mut state);
        assert!(press(&mut state).fired);
        // Second double-tap immediately after — both presses still count.
        release(&mut state);
        assert!(!press(&mut state).fired);
        release(&mut state);
        assert!(press(&mut state).fired);
    }

    /// A normal double-tap fires exactly once, including at its key-up edges.
    #[test]
    fn a_normal_double_tap_fires_exactly_once() {
        let mut state = fresh_state();
        let mut fires = 0;
        let events = [
            (true, true),   // first tap
            (false, false), // key-up
            (true, true),   // second tap → fires
            (false, false), // key-up (fires nothing)
            (false, false), // duplicate key-up (fires nothing)
        ];
        for (down, physical) in events {
            if evaluate_activation(&mut state, down, physical).fired {
                fires += 1;
            }
        }
        assert_eq!(fires, 1);
        assert!(state.last_trigger.is_none());
    }

    /// Auto-repeat while the summon key is held must not register as new taps.
    #[test]
    fn auto_repeat_of_a_held_key_is_ignored() {
        let mut state = fresh_state();
        assert!(!press(&mut state).fired);
        // The OS delivers repeated key-downs while the key is held; none of them
        // may complete a double-tap on their own.
        assert!(!press(&mut state).fired);
        assert!(!press(&mut state).fired);
        assert!(state.last_trigger.is_some());
    }

    /// A fired sequence is cleared, so one physical double-tap cannot fire twice
    /// and a fresh sequence starts from the next press.
    #[test]
    fn firing_clears_the_sequence() {
        let mut state = ActivationState {
            last_trigger: Some(Instant::now()),
            ..fresh_state()
        };
        assert!(press(&mut state).fired);
        assert!(state.last_trigger.is_none());
        // The same held press cannot fire again.
        assert!(!press(&mut state).fired);
        assert!(state.last_trigger.is_none());
    }

    /// The silence clock is updated by every event, in both directions, so a
    /// key-up ends the silence the timeout measures.
    #[test]
    fn key_ups_end_the_silence() {
        let mut state = fresh_state();
        state.last_event = Some(Instant::now() - Duration::from_secs(5));
        release(&mut state);
        assert!(state
            .last_event
            .is_some_and(|last| last.elapsed() < Duration::from_secs(1)));
    }
}
