//! Compiled default values for the application configuration.
//!
//! This is the ONE place where QuickAI's default configuration lives. Every
//! other subsystem reads the resolved values from `AppConfig` via Tauri state.
//! Changing a default here propagates to a fresh first-run config file and to
//! any field a user has left unset or left empty in their existing file.

use crate::providers::Provider;

/// Built-in assistant persona prompt. User overrides via `[prompt] system` in
/// the config file. The slash-command appendix is composed on top at load time
/// and is never written back to the file.
pub const DEFAULT_SYSTEM_PROMPT_BASE: &str = include_str!("../../prompts/system_prompt.txt");

/// Generated appendix listing supported slash commands. Composed on top of
/// the user-editable base prompt at load time so built-in command knowledge
/// stays in sync with the registry even when the persona prompt is overridden.
pub const SLASH_COMMAND_PROMPT_APPENDIX: &str =
    include_str!("../../prompts/generated/slash_commands.txt");

/// Window defaults (logical pixels and counts). Only the user-tunable knobs
/// live here; the collapsed-bar height and the close-animation deadline are
/// baked into `App.tsx` because their effective range is invisible to users
/// (see the rationale comment on `WindowSection` in `schema.rs`).
pub const DEFAULT_OVERLAY_WIDTH: f64 = 600.0;
pub const DEFAULT_MAX_CHAT_HEIGHT: f64 = 648.0;
/// Maximum number of manually attached images per message. One additional
/// image from /screen capture is allowed on top of this, so the total
/// per-message image count is max_images + 1. Raise for more visual context
/// per message; lower to keep prompts compact.
pub const DEFAULT_MAX_IMAGES: u32 = 3;

/// Quote display defaults.
pub const DEFAULT_QUOTE_MAX_DISPLAY_LINES: u32 = 4;
pub const DEFAULT_QUOTE_MAX_DISPLAY_CHARS: u32 = 300;
pub const DEFAULT_QUOTE_MAX_CONTEXT_LENGTH: u32 = 4096;

/// Numeric sanity bounds used by the loader to reject values that would brick
/// the UI. Out-of-bounds values fall back to compiled defaults. The bounds
/// themselves are intentionally generous: the intent is to catch typos
/// (zeros, missing digits), not to second-guess tasteful customization.
pub const BOUNDS_OVERLAY_WIDTH: (f64, f64) = (200.0, 2000.0);
pub const BOUNDS_MAX_CHAT_HEIGHT: (f64, f64) = (200.0, 2000.0);
pub const BOUNDS_MAX_IMAGES: (u32, u32) = (1, 20);
pub const BOUNDS_QUOTE_MAX_DISPLAY_LINES: (u32, u32) = (1, 100);
pub const BOUNDS_QUOTE_MAX_DISPLAY_CHARS: (u32, u32) = (1, 10_000);
pub const BOUNDS_QUOTE_MAX_CONTEXT_LENGTH: (u32, u32) = (1, 65_536);

/// Chat provider defaults, driving main chat, vision, and `/think`.
pub const DEFAULT_CHAT_PROVIDER: Provider = Provider::OpenAi;
pub const DEFAULT_CHAT_MODEL: &str = "gpt-4o";
/// Empty means "use the provider default base URL" (see
/// `providers::resolve_base_url`).
pub const DEFAULT_CHAT_BASE_URL: &str = "";

/// Agent mode (computer control) defaults, driving `/do`.
pub const DEFAULT_AGENT_PROVIDER: Provider = Provider::OpenAi;
/// Empty until the user configures agent mode in Settings.
pub const DEFAULT_AGENT_MODEL: &str = "";
/// Empty means "use the provider default base URL".
pub const DEFAULT_AGENT_BASE_URL: &str = "";

/// Authoritative allowlist of `(section, key)` pairs the Settings GUI is
/// permitted to write via the `set_config_field` Tauri command.
///
/// This list is the security boundary between the frontend and the on-disk
/// configuration. The command rejects any `(section, key)` not present here
/// with a typed `UnknownSection` / `UnknownField` error, preventing the GUI
/// from attempting to write fields that do not exist or that are intentionally
/// not user-tunable.
///
/// A compile-time test (`settings_commands::tests::allowed_fields_count_matches_schema_field_count`)
/// asserts the list size matches the count of tunable fields in `AppConfig` so
/// any future schema addition must extend this list explicitly.
///
/// Order matches `AppConfig` field ordering for review-friendliness.
pub const ALLOWED_FIELDS: &[(&str, &str)] = &[
    // [prompt]
    ("prompt", "system"),
    // [window]
    ("window", "overlay_width"),
    ("window", "max_chat_height"),
    ("window", "max_images"),
    // [quote]
    ("quote", "max_display_lines"),
    ("quote", "max_display_chars"),
    ("quote", "max_context_length"),
    // [chat]
    ("chat", "provider"),
    ("chat", "model"),
    ("chat", "base_url"),
    // [agent]
    ("agent", "provider"),
    ("agent", "model"),
    ("agent", "base_url"),
];

/// Authoritative allowlist of section names accepted by `reset_config`.
/// Mirrors the top-level structure of `AppConfig`.
pub const ALLOWED_SECTIONS: &[&str] = &["prompt", "window", "quote", "chat", "agent"];
