//! Desktop automation via Win32 input simulation.
//!
//! Provides mouse (click, drag, scroll), keyboard (type, key combos),
//! and application launching for the agent mode loop.

use serde::{Deserialize, Serialize};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_TYPE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY, VK_BACK, VK_CAPITAL, VK_DELETE,
    VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_F10, VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6,
    VK_F7, VK_F8, VK_F9, VK_HOME, VK_INSERT, VK_LCONTROL, VK_LEFT, VK_LMENU, VK_LSHIFT, VK_NEXT,
    VK_NUMLOCK, VK_PACKET, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SNAPSHOT, VK_SPACE, VK_TAB, VK_UP,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{SetCursorPos, SW_SHOWNORMAL};

// ─── Action types ───────────────────────────────────────────────────────────────

/// Actions the agent can request to control the desktop.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "params")]
pub enum AgentAction {
    Click {
        x: i32,
        y: i32,
    },
    DoubleClick {
        x: i32,
        y: i32,
    },
    RightClick {
        x: i32,
        y: i32,
    },
    Drag {
        start_x: i32,
        start_y: i32,
        end_x: i32,
        end_y: i32,
        duration_ms: u32,
    },
    TypeText {
        text: String,
    },
    KeyPress {
        modifiers: Vec<String>,
        key: String,
    },
    Scroll {
        direction: String,
        amount: i32,
    },
    Launch {
        target: String,
    },
    ListDir {
        path: String,
    },
    Done {
        summary: String,
    },
    Screenshot {},
}

/// Direction for scroll actions.
pub const SCROLL_UP: &str = "up";
pub const SCROLL_DOWN: &str = "down";

// ─── Mouse control ──────────────────────────────────────────────────────────────

const MOUSEEVENTF_LEFTDOWN: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0002);
const MOUSEEVENTF_LEFTUP: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0004);
const MOUSEEVENTF_RIGHTDOWN: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0008);
const MOUSEEVENTF_RIGHTUP: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0010);
const MOUSEEVENTF_WHEEL: MOUSE_EVENT_FLAGS = MOUSE_EVENT_FLAGS(0x0800);
const WHEEL_DELTA: i32 = 120;

/// Moves the cursor to absolute screen coordinates.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn set_cursor_pos(x: i32, y: i32) -> Result<(), String> {
    unsafe { SetCursorPos(x, y).map_err(|e| format!("SetCursorPos failed: {e}")) }
}

/// Left-clicks at the given screen coordinates.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_click(x: i32, y: i32) -> Result<(), String> {
    set_cursor_pos(x, y)?;
    let inputs = [
        mouse_input(MOUSEEVENTF_LEFTDOWN, 0, 0, 0),
        mouse_input(MOUSEEVENTF_LEFTUP, 0, 0, 0),
    ];
    send_inputs(&inputs);
    Ok(())
}

/// Double-clicks at the given screen coordinates.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_double_click(x: i32, y: i32) -> Result<(), String> {
    set_cursor_pos(x, y)?;
    let inputs = [
        mouse_input(MOUSEEVENTF_LEFTDOWN, 0, 0, 0),
        mouse_input(MOUSEEVENTF_LEFTUP, 0, 0, 0),
        mouse_input(MOUSEEVENTF_LEFTDOWN, 0, 0, 0),
        mouse_input(MOUSEEVENTF_LEFTUP, 0, 0, 0),
    ];
    send_inputs(&inputs);
    // Brief pause between the two clicks for double-click recognition.
    std::thread::sleep(std::time::Duration::from_millis(100));
    Ok(())
}

/// Right-clicks at the given screen coordinates.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_right_click(x: i32, y: i32) -> Result<(), String> {
    set_cursor_pos(x, y)?;
    let inputs = [
        mouse_input(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0),
        mouse_input(MOUSEEVENTF_RIGHTUP, 0, 0, 0),
    ];
    send_inputs(&inputs);
    Ok(())
}

/// Drags from (start_x, start_y) to (end_x, end_y) over the given duration.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_drag(
    start_x: i32,
    start_y: i32,
    end_x: i32,
    end_y: i32,
    duration_ms: u32,
) -> Result<(), String> {
    set_cursor_pos(start_x, start_y)?;
    let down = mouse_input(MOUSEEVENTF_LEFTDOWN, 0, 0, 0);
    send_inputs(&[down]);

    let steps = 10.max(duration_ms / 16) as i32;
    let dx = (end_x - start_x) / steps;
    let dy = (end_y - start_y) / steps;
    let step_delay = duration_ms / steps.max(1) as u32;

    for i in 1..=steps {
        std::thread::sleep(std::time::Duration::from_millis(step_delay as u64));
        set_cursor_pos(start_x + dx * i, start_y + dy * i)?;
    }

    let up = mouse_input(MOUSEEVENTF_LEFTUP, 0, 0, 0);
    send_inputs(&[up]);
    Ok(())
}

/// Scrolls at the current cursor position.
/// Positive amount scrolls down, negative scrolls up.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_scroll(direction: &str, amount: i32) -> Result<(), String> {
    let delta = match direction {
        SCROLL_UP => -amount * WHEEL_DELTA,
        SCROLL_DOWN => amount * WHEEL_DELTA,
        _ => return Err(format!("Unknown scroll direction: {direction}")),
    };
    let input = mouse_input(MOUSEEVENTF_WHEEL, 0, 0, delta);
    send_inputs(&[input]);
    Ok(())
}

// ─── Keyboard control ──────────────────────────────────────────────────────────

/// Named virtual key mapping for KeyPress actions.
fn named_vk(name: &str) -> Option<u16> {
    match name.to_lowercase().as_str() {
        "enter" | "return" => Some(VK_RETURN.0),
        "tab" => Some(VK_TAB.0),
        "escape" | "esc" => Some(VK_ESCAPE.0),
        "backspace" | "back" => Some(VK_BACK.0),
        "delete" | "del" => Some(VK_DELETE.0),
        "home" => Some(VK_HOME.0),
        "end" => Some(VK_END.0),
        "pageup" | "page_up" => Some(VK_PRIOR.0),
        "pagedown" | "page_down" => Some(VK_NEXT.0),
        "up" | "arrow_up" => Some(VK_UP.0),
        "down" | "arrow_down" => Some(VK_DOWN.0),
        "left" | "arrow_left" => Some(VK_LEFT.0),
        "right" | "arrow_right" => Some(VK_RIGHT.0),
        "space" => Some(VK_SPACE.0),
        "capslock" | "caps_lock" => Some(VK_CAPITAL.0),
        "numlock" | "num_lock" => Some(VK_NUMLOCK.0),
        "printscreen" | "print_screen" => Some(VK_SNAPSHOT.0),
        "insert" => Some(VK_INSERT.0),
        "f1" => Some(VK_F1.0),
        "f2" => Some(VK_F2.0),
        "f3" => Some(VK_F3.0),
        "f4" => Some(VK_F4.0),
        "f5" => Some(VK_F5.0),
        "f6" => Some(VK_F6.0),
        "f7" => Some(VK_F7.0),
        "f8" => Some(VK_F8.0),
        "f9" => Some(VK_F9.0),
        "f10" => Some(VK_F10.0),
        "f11" => Some(VK_F11.0),
        "f12" => Some(VK_F12.0),
        _ => None,
    }
}

/// Named modifier key mapping.
fn named_modifier_vk(name: &str) -> Option<u16> {
    match name.to_lowercase().as_str() {
        "ctrl" | "control" => Some(VK_LCONTROL.0),
        "alt" | "menu" => Some(VK_LMENU.0),
        "shift" => Some(VK_LSHIFT.0),
        _ => None,
    }
}

/// Types text character by character using VK_PACKET for Unicode support.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_type_text(text: &str) -> Result<(), String> {
    for ch in text.chars() {
        let inputs = [
            INPUT {
                r#type: INPUT_TYPE(1),
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_PACKET,
                        wScan: ch as u16,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_TYPE(1),
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_PACKET,
                        wScan: ch as u16,
                        dwFlags: KEYEVENTF_KEYUP | KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        send_inputs(&inputs);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}

/// Presses a key combination (e.g., ctrl+c, alt+tab).
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_key_press(modifiers: &[String], key: &str) -> Result<(), String> {
    let vk = named_vk(key)
        .or_else(|| {
            // Single character key (e.g., "a", "1")
            let chars: Vec<char> = key.chars().collect();
            if chars.len() == 1 {
                Some(chars[0] as u16)
            } else {
                None
            }
        })
        .ok_or_else(|| format!("Unknown key: {key}"))?;

    let modifier_vks: Vec<u16> = modifiers
        .iter()
        .filter_map(|m| named_modifier_vk(m))
        .collect();

    // Check that all modifiers were recognized.
    if modifier_vks.len() != modifiers.len() {
        let unknown: Vec<&String> = modifiers
            .iter()
            .filter(|m| named_modifier_vk(m).is_none())
            .collect();
        return Err(format!("Unknown modifiers: {:?}", unknown));
    }

    let mut inputs: Vec<INPUT> = Vec::with_capacity(modifier_vks.len() * 2 + 2);

    // Press modifiers.
    for &mvk in &modifier_vks {
        inputs.push(key_input(mvk, false));
    }

    // Press main key.
    inputs.push(key_input(vk, false));

    // Release main key.
    inputs.push(key_input(vk, true));

    // Release modifiers in reverse order.
    for &mvk in modifier_vks.iter().rev() {
        inputs.push(key_input(mvk, true));
    }

    send_inputs(&inputs);
    Ok(())
}

/// `ShellExecuteW` returns a value greater than 32 on success. The range
/// `0..=32` is reserved for error codes — `SE_ERR_FNF` (2), `SE_ERR_PNF` (3),
/// `SE_ERR_ACCESSDENIED` (5), `SE_ERR_NOASSOC` (31) and friends.
const SHELL_EXECUTE_SUCCESS_THRESHOLD: isize = 32;

/// Invokes `ShellExecuteW` for `file`, optionally with `parameters`, and returns
/// the raw result as an `isize` (the `HINSTANCE` the API returns).
///
/// The Shell API resolves a program name, a document path, or a URL, and shows
/// no UI of its own: a missing target simply comes back as an error code, so the
/// caller can report it instead of leaking an OS dialog.
#[cfg_attr(coverage_nightly, coverage(off))]
fn shell_execute(file: &str, parameters: Option<&str>) -> isize {
    let file = HSTRING::from(file);
    let parameters = parameters.map(HSTRING::from);
    let parameters_ptr = parameters
        .as_ref()
        .map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr()));
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(file.as_ptr()),
            parameters_ptr,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    result.0 as isize
}

/// Splits a model-supplied launch target into `(program, parameters)`.
///
/// The tool contract is a single program, file, or URL, but models sometimes put
/// "program arg" in one string (e.g. `explorer.exe C:\dir`). The old
/// `cmd /c start` body split that itself; doing it explicitly keeps the same
/// behaviour without handing the string to a shell. Returns `(target, None)`
/// when there is no space or the leading token is empty, so a plain path is
/// never broken apart needlessly.
fn split_launch_target(target: &str) -> (&str, Option<&str>) {
    match target.split_once(' ') {
        Some((program, rest)) if !program.is_empty() => (program, Some(rest)),
        _ => (target, None),
    }
}

/// Launches a program, file, or URL via `ShellExecuteW`.
///
/// This is a direct call into the Shell API — deliberately **not** through a
/// shell. The previous body was `cmd /c start "" <target>`: `cmd.exe` re-parses
/// its own command line, so a target containing spaces was split into separate
/// tokens and the whole string could be handed to `ShellExecute` as one bogus
/// filename, which surfaced as a modal "Windows 找不到文件 …" dialog naming a
/// mangled path. Calling the API directly passes `target` as a single string —
/// no re-parsing — and a failure comes back as our own error string (recorded in
/// the run history) rather than an OS dialog.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_launch(target: &str) -> Result<(), String> {
    let code = shell_execute(target, None);
    if code > SHELL_EXECUTE_SUCCESS_THRESHOLD {
        return Ok(());
    }

    // Retry as "program arg" for the models that put both in one string.
    let (program, parameters) = split_launch_target(target);
    if parameters.is_some() && shell_execute(program, parameters) > SHELL_EXECUTE_SUCCESS_THRESHOLD
    {
        return Ok(());
    }

    Err(format!(
        "Failed to launch '{target}': ShellExecute error {code}"
    ))
}

// ─── Directory listing ───────────────────────────────────────────────────────────

/// Maximum number of entries a single directory listing returns.
///
/// The listing is a silent, headless read channel straight into the model's
/// context, so it is bounded: a large folder cannot flood the conversation.
pub const MAX_LIST_DIR_ENTRIES: usize = 200;

/// Replaces control characters in an entry name so a name can never span more
/// than one line of the listing.
///
/// Windows forbids control characters in file names, so this is
/// defence-in-depth for the text format the model reads rather than a live case.
fn sanitize_entry_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_control() { '?' } else { c })
        .collect()
}

/// Lists the entries of a directory for the agent.
///
/// **Names only — never file contents.** Each entry is a bare file name, with a
/// trailing `/` appended for directories so the model can tell the two apart.
/// Directories are listed first, then files, each group sorted. The result is
/// capped at [`MAX_LIST_DIR_ENTRIES`] entries and says so when it truncates.
///
/// A path that does not exist, a path that is not a directory, and a directory
/// that cannot be read (e.g. permission denied) each come back as a descriptive
/// `Err` string — this never panics.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_list_dir(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Directory path is empty".to_string());
    }

    // Distinguishes "does not exist / unreadable" from "exists but is a file"
    // before attempting the read, so the model gets an actionable message.
    let metadata = std::fs::metadata(path).map_err(|e| format!("Cannot access '{path}': {e}"))?;
    if !metadata.is_dir() {
        return Err(format!("Not a directory: '{path}'"));
    }

    let entries =
        std::fs::read_dir(path).map_err(|e| format!("Cannot read directory '{path}': {e}"))?;

    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut truncated = false;

    for entry in entries {
        if dirs.len() + files.len() >= MAX_LIST_DIR_ENTRIES {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|e| format!("Cannot read directory '{path}': {e}"))?;
        let name = sanitize_entry_name(&entry.file_name().to_string_lossy());
        // `file_type` uses the directory entry's own type where the OS provides
        // it, avoiding a stat per entry; an error is treated as "not a dir".
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            dirs.push(format!("{name}/"));
        } else {
            files.push(name);
        }
    }

    dirs.sort();
    files.sort();

    let mut out = format!("Directory: {path}\n");
    if dirs.is_empty() && files.is_empty() {
        out.push_str("(empty)\n");
    } else {
        for name in dirs.iter().chain(files.iter()) {
            out.push_str(name);
            out.push('\n');
        }
    }
    if truncated {
        out.push_str(&format!(
            "... (truncated at {MAX_LIST_DIR_ENTRIES} entries)\n"
        ));
    }
    Ok(out)
}

// ─── Action dispatcher ──────────────────────────────────────────────────────────

/// Executes a single agent action.
///
/// Returns the action's payload: an empty string for actions whose only outcome
/// is success or failure (every action but `ListDir`), or the listing text for
/// `ListDir`, which is the one action whose result the model must actually read.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn execute_action(action: &AgentAction) -> Result<String, String> {
    let result = match action {
        AgentAction::Click { x, y } => execute_click(*x, *y),
        AgentAction::DoubleClick { x, y } => execute_double_click(*x, *y),
        AgentAction::RightClick { x, y } => execute_right_click(*x, *y),
        AgentAction::Drag {
            start_x,
            start_y,
            end_x,
            end_y,
            duration_ms,
        } => execute_drag(*start_x, *start_y, *end_x, *end_y, *duration_ms),
        AgentAction::TypeText { text } => execute_type_text(text),
        AgentAction::KeyPress { modifiers, key } => execute_key_press(modifiers, key),
        AgentAction::Scroll { direction, amount } => execute_scroll(direction, *amount),
        AgentAction::Launch { target } => execute_launch(target),
        // The only action that yields data for the model: return its listing
        // directly instead of the empty success marker.
        AgentAction::ListDir { path } => return execute_list_dir(path),
        AgentAction::Done { .. } | AgentAction::Screenshot {} => Ok(()),
    };
    result.map(|()| String::new())
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

fn mouse_input(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, scroll_delta: i32) -> INPUT {
    INPUT {
        r#type: INPUT_TYPE(0),
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: scroll_delta as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn key_input(vk: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_TYPE(1),
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send_inputs(inputs: &[INPUT]) {
    unsafe {
        SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_vk_maps_common_keys() {
        assert_eq!(named_vk("enter"), Some(VK_RETURN.0));
        assert_eq!(named_vk("tab"), Some(VK_TAB.0));
        assert_eq!(named_vk("escape"), Some(VK_ESCAPE.0));
        assert_eq!(named_vk("backspace"), Some(VK_BACK.0));
        assert_eq!(named_vk("delete"), Some(VK_DELETE.0));
        assert_eq!(named_vk("f1"), Some(VK_F1.0));
        assert_eq!(named_vk("space"), Some(VK_SPACE.0));
    }

    #[test]
    fn named_vk_unknown_returns_none() {
        assert!(named_vk("unknown").is_none());
        assert!(named_vk("a").is_none());
    }

    #[test]
    fn named_modifier_vk_maps_modifiers() {
        assert_eq!(named_modifier_vk("ctrl"), Some(VK_LCONTROL.0));
        assert_eq!(named_modifier_vk("alt"), Some(VK_LMENU.0));
        assert_eq!(named_modifier_vk("shift"), Some(VK_LSHIFT.0));
    }

    #[test]
    fn named_modifier_vk_unknown_returns_none() {
        assert!(named_modifier_vk("super").is_none());
    }

    #[test]
    fn action_serialization_roundtrip() {
        let actions = vec![
            AgentAction::Click { x: 100, y: 200 },
            AgentAction::TypeText {
                text: "Hello".to_string(),
            },
            AgentAction::KeyPress {
                modifiers: vec!["ctrl".to_string()],
                key: "c".to_string(),
            },
            AgentAction::ListDir {
                path: "C:\\Users\\lawrence_lv\\Desktop".to_string(),
            },
            AgentAction::Done {
                summary: "Done".to_string(),
            },
        ];
        for action in actions {
            let json = serde_json::to_string(&action).unwrap();
            let deserialized: AgentAction = serde_json::from_str(&json).unwrap();
            assert_eq!(json, serde_json::to_string(&deserialized).unwrap());
        }
    }

    #[test]
    fn scroll_constants() {
        assert_eq!(SCROLL_UP, "up");
        assert_eq!(SCROLL_DOWN, "down");
        assert_eq!(WHEEL_DELTA, 120);
    }

    #[test]
    fn split_launch_target_keeps_a_plain_target_whole() {
        assert_eq!(split_launch_target("notepad"), ("notepad", None));
        assert_eq!(
            split_launch_target("https://example.com"),
            ("https://example.com", None)
        );
        // A leading space leaves an empty program name: keep the target intact.
        assert_eq!(split_launch_target(" notepad"), (" notepad", None));
    }

    #[test]
    fn split_launch_target_splits_program_from_arguments() {
        assert_eq!(
            split_launch_target("explorer.exe C:\\Users\\lawrence_lv\\Desktop"),
            ("explorer.exe", Some("C:\\Users\\lawrence_lv\\Desktop"))
        );
        // Only the first space splits; the rest stays with the arguments.
        assert_eq!(split_launch_target("cmd /c dir"), ("cmd", Some("/c dir")));
    }

    #[test]
    fn execute_launch_reports_a_missing_target_instead_of_panicking() {
        // A path that cannot exist: the Shell API returns an error code (and
        // shows no dialog), which must surface as our own `Err`.
        let result = execute_launch("Z:\\quickai_launch_test_nonexistent\\file.xyz");
        assert!(result.is_err());
    }

    // ─── Directory listing ───────────────────────────────────────────────────

    /// A uniquely named scratch directory under the OS temp dir. The caller
    /// removes it; `create` decides whether it is made here.
    fn scratch_dir(name: &str, create: bool) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("quickai_list_dir_test_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        if create {
            std::fs::create_dir_all(&dir).unwrap();
        }
        dir
    }

    #[test]
    fn sanitize_entry_name_replaces_control_characters() {
        assert_eq!(sanitize_entry_name("plain.txt"), "plain.txt");
        assert_eq!(sanitize_entry_name("a\nb"), "a?b");
        assert_eq!(sanitize_entry_name("a\tb\rc"), "a?b?c");
    }

    #[test]
    fn list_dir_lists_directories_first_then_files() {
        let root = scratch_dir("ok", true);
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("a.txt"), b"SECRET_FILE_CONTENTS").unwrap();
        std::fs::write(root.join("b.txt"), b"SECRET_FILE_CONTENTS").unwrap();

        let listing = execute_list_dir(root.to_str().unwrap()).unwrap();
        assert!(listing.contains("Directory:"));
        // Directories carry a trailing slash; files do not.
        assert!(listing.contains("sub/"));
        assert!(listing.contains("a.txt"));
        assert!(listing.contains("b.txt"));
        // Directories sort before files.
        assert!(listing.find("sub/").unwrap() < listing.find("a.txt").unwrap());
        // Names only: file contents are never returned.
        assert!(!listing.contains("SECRET_FILE_CONTENTS"));

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn list_dir_reports_an_empty_directory() {
        let root = scratch_dir("empty", true);
        let listing = execute_list_dir(root.to_str().unwrap()).unwrap();
        assert!(listing.contains("(empty)"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn list_dir_rejects_an_empty_or_blank_path() {
        assert!(execute_list_dir("").is_err());
        assert!(execute_list_dir("   ").is_err());
    }

    #[test]
    fn list_dir_reports_a_missing_path_without_panicking() {
        let missing = scratch_dir("missing", false);
        let err = execute_list_dir(missing.to_str().unwrap()).unwrap_err();
        assert!(err.contains("Cannot access"));
    }

    #[test]
    fn list_dir_reports_a_file_as_not_a_directory() {
        let root = scratch_dir("file", true);
        let file = root.join("only_a_file.txt");
        std::fs::write(&file, b"data").unwrap();

        let err = execute_list_dir(file.to_str().unwrap()).unwrap_err();
        assert!(err.contains("Not a directory"));
        // The path is echoed back so the model can correct itself.
        assert!(err.contains("only_a_file.txt"));

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn list_dir_caps_the_entry_count_and_says_so() {
        let root = scratch_dir("cap", true);
        for i in 0..(MAX_LIST_DIR_ENTRIES + 5) {
            std::fs::write(root.join(format!("f{i:04}.txt")), b"x").unwrap();
        }

        let listing = execute_list_dir(root.to_str().unwrap()).unwrap();
        assert!(listing.contains("truncated"));
        // Exactly the cap is listed; the truncation note is not an entry line.
        let entry_lines = listing.lines().filter(|l| l.ends_with(".txt")).count();
        assert_eq!(entry_lines, MAX_LIST_DIR_ENTRIES);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn execute_action_returns_a_listing_payload_for_list_dir() {
        let root = scratch_dir("dispatch", true);
        std::fs::write(root.join("note.md"), b"x").unwrap();

        let payload = execute_action(&AgentAction::ListDir {
            path: root.to_str().unwrap().to_string(),
        })
        .unwrap();
        assert!(payload.contains("note.md"));

        // Every other action reports success with an empty payload.
        let empty = execute_action(&AgentAction::Done {
            summary: "done".to_string(),
        })
        .unwrap();
        assert!(empty.is_empty());

        std::fs::remove_dir_all(&root).unwrap();
    }
}
