//! Config file load, parse, and resolve-to-defaults pipeline.
//!
//! Flow:
//!   1. Read file from `path`.
//!        - Missing (NotFound)     -> seed defaults, write them, return defaults.
//!        - Permission / I/O error -> log, return defaults (no seed attempt).
//!        - Ok(contents)           -> fall through to parse.
//!   2. Parse TOML.
//!        - Parse error -> rename file to `<name>.corrupt-<ts>`, seed defaults.
//!   3. Resolve (empties -> defaults, out-of-bounds -> defaults, compose appendix).
//!
//! Additive schema evolution (new fields, new sections) is handled for free by
//! serde's `#[serde(default)]`: missing fields in an older file deserialize to
//! their compiled defaults and user customizations are preserved. No version
//! field is needed.
//!
//! All "rename and reseed" paths are non-fatal. Only first-run seed failure is
//! fatal (the app cannot boot in a writable-hostile environment and the user
//! cannot fix that from the UI).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::defaults::{
    BOUNDS_MAX_CHAT_HEIGHT, BOUNDS_MAX_IMAGES, BOUNDS_OVERLAY_WIDTH,
    BOUNDS_QUOTE_MAX_CONTEXT_LENGTH, BOUNDS_QUOTE_MAX_DISPLAY_CHARS,
    BOUNDS_QUOTE_MAX_DISPLAY_LINES, DEFAULT_CHAT_MODEL, DEFAULT_MAX_CHAT_HEIGHT,
    DEFAULT_MAX_IMAGES, DEFAULT_OVERLAY_WIDTH, DEFAULT_QUOTE_MAX_CONTEXT_LENGTH,
    DEFAULT_QUOTE_MAX_DISPLAY_CHARS, DEFAULT_QUOTE_MAX_DISPLAY_LINES, DEFAULT_SYSTEM_PROMPT_BASE,
    SLASH_COMMAND_PROMPT_APPENDIX,
};
use super::error::ConfigError;
use super::schema::AppConfig;
use super::writer::atomic_write;

/// Loads the configuration from the given path, applying every recovery rule
/// described in the module doc. Returns a fully-resolved, validated `AppConfig`
/// on success. Returns `Err(ConfigError::SeedFailed)` only if the file was
/// missing and the default seed write failed.
pub fn load_from_path(path: &Path) -> Result<AppConfig, ConfigError> {
    match std::fs::read_to_string(path) {
        Ok(contents) => load_from_contents(path, &contents),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => seed_defaults(path),
        Err(source) => {
            eprintln!(
                "quickai: [config] cannot read {}: {source}. using in-memory defaults",
                path.display()
            );
            let mut config = AppConfig::default();
            resolve(&mut config);
            Ok(config)
        }
    }
}

fn load_from_contents(path: &Path, contents: &str) -> Result<AppConfig, ConfigError> {
    match toml::from_str::<AppConfig>(contents) {
        Ok(mut config) => {
            resolve(&mut config);
            Ok(config)
        }
        Err(parse_err) => {
            eprintln!(
                "quickai: [config] parse error at {}: {parse_err}. renaming and reseeding defaults",
                path.display()
            );
            rename_corrupt(path);
            seed_defaults(path)
        }
    }
}

/// Writes the compiled defaults to `path` and returns the resolved `AppConfig`.
/// This is the first-run path; any failure here is fatal and surfaced to the
/// caller (`lib.rs` shows a dialog and quits).
fn seed_defaults(path: &Path) -> Result<AppConfig, ConfigError> {
    let mut config = AppConfig::default();
    resolve(&mut config);
    atomic_write(path, &config).map_err(|source| ConfigError::SeedFailed {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(config)
}

/// Renames a corrupt or incompatible file to `<path>.corrupt-<unix_ts>` and
/// writes a one-line marker file at `<dir>/.corrupt-recovery-pending` containing
/// the absolute path of the renamed file.
///
/// The Settings window reads (and deletes) the marker via the
/// `get_corrupt_marker` Tauri command on mount so it can render a recovery
/// banner. Both rename and marker-write are best-effort: failures are logged
/// but do not block the default reseed.
fn rename_corrupt(path: &Path) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut target = path.as_os_str().to_os_string();
    target.push(format!(".corrupt-{ts}"));
    let target: PathBuf = target.into();
    if !try_rename_corrupt(path, &target) {
        return;
    }
    // `path.parent()` is `None` only for filesystem roots like `/`, which we
    // can never receive here (callers always pass `<dir>/config.toml`). Use a
    // `unwrap_or` value so the fallback path stays in the binary without an
    // unreachable closure region that coverage cannot exercise.
    let parent = path.parent().unwrap_or(Path::new("."));
    write_corrupt_marker(parent, &target, ts);
}

/// Renames `path` to `target`, logging and returning `false` on failure.
/// Split out so the failure branch is reachable from a cross-platform test
/// (a rename onto a non-empty directory fails on every platform).
pub(crate) fn try_rename_corrupt(path: &Path, target: &Path) -> bool {
    match std::fs::rename(path, target) {
        Ok(()) => true,
        Err(e) => {
            eprintln!(
                "quickai: [config] could not rename corrupt file {}: {e}",
                path.display()
            );
            false
        }
    }
}

/// Writes the one-line recovery marker next to the renamed file. Best-effort:
/// a failure is logged but does not block the default reseed.
pub(crate) fn write_corrupt_marker(parent: &Path, target: &Path, ts: u64) {
    let marker_path = parent.join(super::CORRUPT_MARKER_FILE_NAME);
    let payload = format!("{}\n{ts}\n", target.display());
    if let Err(e) = std::fs::write(&marker_path, payload) {
        eprintln!(
            "quickai: [config] could not write corrupt marker at {}: {e}",
            marker_path.display()
        );
    }
}

/// Resolves empty strings to compiled defaults, clamps out-of-bounds numerics,
/// and composes the system prompt appendix into `prompt.resolved_system`.
/// After this runs, every `AppConfig` field holds a usable value.
pub(crate) fn resolve(config: &mut AppConfig) {
    // Prompt section: empty base -> built-in. Compose resolved_system.
    let base = if config.prompt.system.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT_BASE
    } else {
        &config.prompt.system
    };
    config.prompt.resolved_system = compose_system_prompt(base, SLASH_COMMAND_PROMPT_APPENDIX);

    // Window section.
    clamp_f64(
        &mut config.window.overlay_width,
        BOUNDS_OVERLAY_WIDTH,
        DEFAULT_OVERLAY_WIDTH,
        "window.overlay_width",
    );
    clamp_f64(
        &mut config.window.max_chat_height,
        BOUNDS_MAX_CHAT_HEIGHT,
        DEFAULT_MAX_CHAT_HEIGHT,
        "window.max_chat_height",
    );
    clamp_u32(
        &mut config.window.max_images,
        BOUNDS_MAX_IMAGES,
        DEFAULT_MAX_IMAGES,
        "window.max_images",
    );

    // Quote section.
    clamp_u32(
        &mut config.quote.max_display_lines,
        BOUNDS_QUOTE_MAX_DISPLAY_LINES,
        DEFAULT_QUOTE_MAX_DISPLAY_LINES,
        "quote.max_display_lines",
    );
    clamp_u32(
        &mut config.quote.max_display_chars,
        BOUNDS_QUOTE_MAX_DISPLAY_CHARS,
        DEFAULT_QUOTE_MAX_DISPLAY_CHARS,
        "quote.max_display_chars",
    );
    clamp_u32(
        &mut config.quote.max_context_length,
        BOUNDS_QUOTE_MAX_CONTEXT_LENGTH,
        DEFAULT_QUOTE_MAX_CONTEXT_LENGTH,
        "quote.max_context_length",
    );

    // Chat section: an empty model falls back to the compiled default so the
    // chat path always has something to send. An empty base_url is intentional
    // (it means "use the provider default"), so it is left untouched.
    if config.chat.model.trim().is_empty() {
        config.chat.model = DEFAULT_CHAT_MODEL.to_string();
    }

    // Agent section: model and base_url are allowed to stay empty (an
    // unconfigured agent is a legitimate state; the agent errors clearly until
    // the user picks a provider and model).
}

/// Composes the user-editable base prompt with the generated slash-command
/// appendix. The result is what the `ask` chat path actually sends to the
/// provider. The file stores only the base; the appendix is never
/// round-tripped.
pub fn compose_system_prompt(base: &str, appendix: &str) -> String {
    let base = base.trim_end();
    let appendix = appendix.trim();
    if appendix.is_empty() {
        base.to_string()
    } else {
        format!("{base}\n\n{appendix}")
    }
}

fn clamp_f64(value: &mut f64, bounds: (f64, f64), default: f64, field: &str) {
    if !value.is_finite() || !(bounds.0..=bounds.1).contains(value) {
        eprintln!(
            "quickai: [config] {field}={value} out of bounds [{min}, {max}]; using default {default}",
            min = bounds.0,
            max = bounds.1,
            value = *value
        );
        *value = default;
    }
}

fn clamp_u32(value: &mut u32, bounds: (u32, u32), default: u32, field: &str) {
    if !(bounds.0..=bounds.1).contains(value) {
        eprintln!(
            "quickai: [config] {field}={value} out of bounds [{min}, {max}]; using default {default}",
            min = bounds.0,
            max = bounds.1,
            value = *value
        );
        *value = default;
    }
}
