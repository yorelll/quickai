//! File-backed diagnostics.
//!
//! QuickAI is a GUI-subsystem process, so there is no console for `eprintln!`
//! to reach and a redirected stderr file is not reliable on Windows. Every
//! diagnostic therefore goes to `<app_config_dir>/quickai.log` — the same
//! per-user directory that holds `config.toml` and `skills.toml`, which the
//! user can open and send.
//!
//! # Never block, never fail
//!
//! Producers push a formatted line into a bounded channel with `try_send`,
//! which cannot block; one writer thread owns the file. If the queue is full,
//! the directory is unwritable, or the writer is gone, the line is simply
//! dropped. Diagnostics must never change the app's behaviour, and the
//! low-level keyboard hook must never wait on the disk.
//!
//! # Rotation
//!
//! The live file is capped at [`MAX_LOG_BYTES`]. When the next line would push
//! it past the cap, the file is rotated to `quickai.log.1` (one previous
//! generation kept, older content discarded) and logging continues in a fresh
//! `quickai.log`.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Must match `identifier` in `tauri.conf.json`: Tauri's `app_config_dir()` is
/// `%APPDATA%\<identifier>` on Windows. A test keeps the two in sync.
const APP_IDENTIFIER: &str = "com.yorelll.quickai";
pub const LOG_FILE_NAME: &str = "quickai.log";
const ROTATED_FILE_NAME: &str = "quickai.log.1";
/// Rotate when the next line would push the live file past this size.
const MAX_LOG_BYTES: u64 = 1024 * 1024;
/// Bounded queue: enough for a burst, small enough to stay cheap.
const CHANNEL_CAPACITY: usize = 1024;
/// Frontend diagnostics are accepted only with this prefix, so the webview
/// cannot write arbitrary text into a file the user is asked to send.
const FRONTEND_SIZE_PREFIX: &str = "[quickai:size]";
/// A frontend line is dropped, not truncated, above this many bytes. A real
/// sizing line is ~300 bytes; the cap stops one caller spending the whole
/// rotation budget on a single line, and dropping avoids splitting UTF-8.
const MAX_FRONTEND_LINE_BYTES: usize = 2048;

static SENDER: OnceLock<SyncSender<Entry>> = OnceLock::new();

/// One queued item. `Flush` is the exit-path acknowledgement.
enum Entry {
    Line(String),
    Flush(mpsc::Sender<()>),
}

/// Writes one diagnostic line to the file log.
///
/// Call sites keep the exact shape of `eprintln!`. The write is queued and can
/// never block the caller; nothing here touches stderr, whose lock and handle
/// are exactly what a GUI-subsystem process cannot rely on (and what the
/// keyboard-hook thread must not wait behind).
#[macro_export]
macro_rules! diag {
    ($($arg:tt)*) => {{
        $crate::diagnostics::log(format!($($arg)*));
    }};
}

/// Starts the file logger. Idempotent and infallible: if the directory or the
/// writer cannot be set up, diagnostics are silently disabled.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn init() {
    let Some(dir) = config_dir() else {
        // No `%APPDATA%`: nothing sensible to write to.
        return;
    };
    init_at(dir);
}

/// Directory-taking form so the writer itself can be exercised by a test.
#[cfg_attr(coverage_nightly, coverage(off))]
fn init_at(dir: PathBuf) {
    let path = dir.join(LOG_FILE_NAME);
    let (sender, receiver) = mpsc::sync_channel(CHANNEL_CAPACITY);
    if SENDER.set(sender).is_err() {
        // Already initialised.
        return;
    }
    log(format!("quickai: [startup] log file={}", path.display()));
    // If the thread cannot start, the queue fills and every later line is
    // dropped — exactly the "diagnostics never fail the app" contract.
    let _ = std::thread::Builder::new()
        .name("quickai-log".into())
        .spawn(move || writer_loop(receiver, path));
}

/// The per-user config directory, resolved without a Tauri handle so that even
/// a second instance — which exits before any window exists — can record its
/// single-instance decision.
fn config_dir() -> Option<PathBuf> {
    config_dir_from(std::env::var_os("APPDATA"))
}

/// Pure join, so both outcomes are testable without touching the environment.
fn config_dir_from(base: Option<std::ffi::OsString>) -> Option<PathBuf> {
    base.map(|base| PathBuf::from(base).join(APP_IDENTIFIER))
}

/// Queues one line. Appends the newline if the caller omitted it. A failed
/// queue (uninitialised, full, or no writer) drops the line.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn log(line: impl AsRef<str>) {
    let Some(sender) = SENDER.get() else {
        return;
    };
    // Every line carries a UTC timestamp. It is computed on the producer side
    // (including the keyboard-hook thread) so the file order and the wall
    // clock can be compared when correlating an `[activator]` line with the
    // `[summon]` decision it produced.
    let mut line = format!("{} {}", format_utc(SystemTime::now()), line.as_ref());
    if !line.ends_with('\n') {
        line.push('\n');
    }
    // `try_send` never blocks; a full queue discards the line rather than
    // stalling — in particular never the low-level keyboard hook thread.
    let _ = sender.try_send(Entry::Line(line));
}

/// Formats `now` as UTC ISO-8601 with milliseconds, e.g.
/// `2026-10-23T09:14:02.381Z`.
///
/// Dependency-free on purpose: the logger is initialised before the rest of
/// the app, and a date crate for one line format is not worth the build cost.
/// A clock before the Unix epoch (a broken system time) degrades to the epoch
/// rather than panicking.
fn format_utc(now: SystemTime) -> String {
    let since = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60,
        since.subsec_millis(),
    )
}

/// Days since 1970-01-01 to `(year, month, day)` in the proleptic Gregorian
/// calendar (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (
        if month <= 2 { year + 1 } else { year },
        month as u32,
        day as u32,
    )
}

/// Waits until the writer has flushed every line queued before this call.
///
/// For **exit paths only** — it can block for up to 500 ms, and callers must
/// never be the UI thread's normal work or the keyboard hook. `app.exit()` and
/// `AppHandle::restart()` terminate the process without running destructors,
/// so without this the last queued lines (including a second instance's
/// single-instance decision) could be lost.
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn flush() {
    let Some(sender) = SENDER.get() else {
        return;
    };
    let (ack, wait) = mpsc::channel();
    if sender.try_send(Entry::Flush(ack)).is_ok() {
        let _ = wait.recv_timeout(std::time::Duration::from_millis(500));
    }
}

/// Appends one frontend diagnostic line to the same file.
///
/// The frontend enables its sizing trace with
/// `localStorage['quickai:debug-size'] === '1'`; it cannot write the file
/// itself, so it sends the finished line here (one command, no schema). Only
/// lines carrying the `[quickai:size]` prefix are accepted.
#[tauri::command]
pub fn log_frontend_diagnostic(line: String) {
    if let Some(line) = frontend_line(&line) {
        log(line);
    }
}

/// Returns the line when it is a permitted frontend diagnostic.
///
/// A frontend line is exactly one line under the size prefix: embedded CR/LF
/// is rejected (it would forge a second entry in a file the user is asked to
/// send), and an oversized line is **dropped** rather than truncated (no
/// split UTF-8, and no way to spend the rotation budget in one call).
fn frontend_line(line: &str) -> Option<&str> {
    let line = line.trim_end();
    if !line.starts_with(FRONTEND_SIZE_PREFIX) {
        return None;
    }
    if line.contains('\r') || line.contains('\n') {
        return None;
    }
    if line.len() > MAX_FRONTEND_LINE_BYTES {
        return None;
    }
    Some(line)
}

/// Whether appending `next` bytes to a file of `written` bytes would exceed the
/// cap and require rotation first.
fn exceeds_cap(written: u64, next: usize) -> bool {
    written.saturating_add(next as u64) > MAX_LOG_BYTES
}

/// The writer thread: drains the queue, appends to the file, rotates at the
/// cap. Any I/O failure drops the affected line and retries the file on the
/// next one.
#[cfg_attr(coverage_nightly, coverage(off))]
fn writer_loop(receiver: Receiver<Entry>, path: PathBuf) {
    let mut file = open_log(&path);
    let mut written = file.as_ref().map(|_| current_len(&path)).unwrap_or(0);

    for entry in receiver {
        let line = match entry {
            Entry::Flush(ack) => {
                // Exit-path flush: make everything already written durable,
                // then release the caller. A failed open has nothing to flush.
                if let Some(handle) = file.as_mut() {
                    let _ = handle.flush();
                }
                let _ = ack.send(());
                continue;
            }
            Entry::Line(line) => line,
        };
        let bytes = line.as_bytes();
        if exceeds_cap(written, bytes.len()) {
            file = None;
            rotate(&path);
            written = 0;
        }
        if file.is_none() {
            file = open_log(&path);
            written = current_len(&path);
        }
        let Some(handle) = file.as_mut() else {
            continue;
        };
        if handle.write_all(bytes).is_ok() {
            written += bytes.len() as u64;
            let _ = handle.flush();
        } else {
            // Drop this line; the next one reopens the file.
            file = None;
            written = 0;
        }
    }
}

#[cfg_attr(coverage_nightly, coverage(off))]
fn open_log(path: &Path) -> Option<File> {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    OpenOptions::new().create(true).append(true).open(path).ok()
}

#[cfg_attr(coverage_nightly, coverage(off))]
fn current_len(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

#[cfg_attr(coverage_nightly, coverage(off))]
fn rotate(path: &Path) {
    let rotated = path.with_file_name(ROTATED_FILE_NAME);
    // Discard the older generation first so the rename is a plain move and
    // the policy does not depend on rename-replace semantics.
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(path, &rotated);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_matches_tauri_config() {
        let raw = include_str!("../tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(raw).expect("tauri.conf.json must be valid JSON");
        assert_eq!(config["identifier"], APP_IDENTIFIER);
    }

    #[test]
    fn only_size_lines_are_accepted_from_the_frontend() {
        assert_eq!(
            frontend_line("[quickai:size] tag innerHeight=113\n"),
            Some("[quickai:size] tag innerHeight=113")
        );
        assert_eq!(frontend_line("[quickai:size] x"), Some("[quickai:size] x"));
        assert_eq!(frontend_line("quickai: [summon] forged"), None);
        assert_eq!(frontend_line(""), None);
    }

    /// A single accepted line must stay a single line: embedded CR/LF would
    /// forge a second entry in the file the user sends us.
    #[test]
    fn frontend_lines_cannot_forge_a_second_line() {
        assert_eq!(
            frontend_line("[quickai:size] x\nquickai: [summon] show applied"),
            None
        );
        assert_eq!(
            frontend_line("[quickai:size] x\rquickai: [summon] show applied"),
            None
        );
        assert_eq!(
            frontend_line("[quickai:size] x\r\nquickai: [summon] show applied"),
            None
        );
        // A normal trailing newline from the IPC layer is still accepted.
        assert_eq!(
            frontend_line("[quickai:size] x\r\n"),
            Some("[quickai:size] x")
        );
    }

    /// Oversized lines are dropped, not truncated; the cap is exact.
    #[test]
    fn oversized_frontend_lines_are_dropped() {
        let at_cap = format!(
            "{} {}",
            FRONTEND_SIZE_PREFIX,
            "x".repeat(MAX_FRONTEND_LINE_BYTES - FRONTEND_SIZE_PREFIX.len() - 1)
        );
        assert_eq!(at_cap.len(), MAX_FRONTEND_LINE_BYTES);
        assert_eq!(frontend_line(&at_cap), Some(at_cap.as_str()));

        let over_cap = format!("{at_cap}x");
        assert_eq!(over_cap.len(), MAX_FRONTEND_LINE_BYTES + 1);
        assert_eq!(frontend_line(&over_cap), None);
    }

    #[test]
    fn utc_timestamps_are_iso8601_with_milliseconds() {
        use std::time::Duration;
        assert_eq!(
            format_utc(UNIX_EPOCH + Duration::from_millis(1_700_000_000_123)),
            "2023-11-14T22:13:20.123Z"
        );
        assert_eq!(format_utc(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        // A leap day, and a January date (the `month <= 2` year adjustment).
        assert_eq!(
            format_utc(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "2000-02-29T00:00:00.000Z"
        );
    }

    #[test]
    fn a_pre_epoch_clock_degrades_to_the_epoch() {
        use std::time::Duration;
        assert_eq!(
            format_utc(UNIX_EPOCH - Duration::from_secs(1)),
            "1970-01-01T00:00:00.000Z"
        );
        // The negative-days branch of the calendar conversion.
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn the_log_frontend_command_accepts_and_rejects() {
        // Both branches run; with no logger initialised the line is dropped.
        log_frontend_diagnostic("[quickai:size] tag innerHeight=113".to_string());
        log_frontend_diagnostic("not a diagnostic".to_string());
    }

    #[test]
    fn the_log_lives_in_the_app_config_dir() {
        let base = PathBuf::from(r"C:\Users\tester\AppData\Roaming");
        assert_eq!(
            config_dir_from(Some(base.clone().into_os_string())),
            Some(base.join(APP_IDENTIFIER))
        );
        assert_eq!(config_dir_from(None), None);
        // The live resolver runs (its answer depends on the environment).
        let _ = config_dir();
    }

    #[test]
    fn the_cap_counts_bytes_not_lines() {
        assert!(!exceeds_cap(MAX_LOG_BYTES - 10, 10));
        assert!(exceeds_cap(MAX_LOG_BYTES - 10, 11));
        assert!(exceeds_cap(MAX_LOG_BYTES, 1));
        // Saturates rather than overflowing.
        assert!(exceeds_cap(u64::MAX, 1));
    }

    /// End-to-end proof that a queued line reaches the file and that `flush`
    /// only returns once it is there. This is the one place the writer runs in
    /// tests; it uses an isolated temp directory, never `%APPDATA%`.
    #[test]
    fn queued_lines_reach_the_file() {
        let dir = std::env::temp_dir().join(format!("quickai-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        init_at(dir.clone());

        log("quickai: [startup] writer round-trip");
        flush();

        let path = dir.join(LOG_FILE_NAME);
        let content = fs::read_to_string(&path).expect("the writer must have created the file");
        assert!(
            content.contains("quickai: [startup] writer round-trip"),
            "log content was: {content}"
        );
        // The init line is queued before the writer starts, so it must be
        // present too.
        assert!(content.contains("quickai: [startup] log file="));
        // No cleanup: the writer keeps the file open for the life of the test
        // process, and the directory is a few hundred bytes under %TEMP%.
    }
}
