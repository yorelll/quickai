//! Typed shape of the QuickAI configuration file.
//!
//! Serde derives the TOML mapping automatically. Each section struct carries
//! `#[serde(default)]` so a partial file (missing whole sections or fields)
//! deserializes cleanly: missing fields inherit the compiled defaults via the
//! manual `Default` impls below.
//!
//! Section structs use manual `Default` impls (NOT `#[derive(Default)]`)
//! because deriving Default would fill fields with zero/empty values
//! (`String::default() == ""`), which is the opposite of what the user expects.
//! `AppConfig` itself uses `#[derive(Default)]` because it delegates entirely
//! to each section's own `Default` impl.

use serde::{Deserialize, Serialize};

use super::defaults::{
    DEFAULT_AGENT_BASE_URL, DEFAULT_AGENT_MODEL, DEFAULT_AGENT_PROVIDER, DEFAULT_CHAT_BASE_URL,
    DEFAULT_CHAT_MODEL, DEFAULT_CHAT_PROVIDER, DEFAULT_MAX_CHAT_HEIGHT, DEFAULT_MAX_IMAGES,
    DEFAULT_OVERLAY_WIDTH, DEFAULT_QUOTE_MAX_CONTEXT_LENGTH, DEFAULT_QUOTE_MAX_DISPLAY_CHARS,
    DEFAULT_QUOTE_MAX_DISPLAY_LINES,
};
use crate::providers::Provider;

/// Prompt configuration. `system` holds only the user-editable base text.
/// The slash-command appendix is composed at load time into `resolved_system`
/// and is never written back to the file. `resolved_system` is computed, not
/// serialized.
///
/// Note: `#[derive(Default)]` is correct here because both fields genuinely
/// start empty: `system` empty means "use the built-in persona", and
/// `resolved_system` is populated by the loader before any consumer reads it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct PromptSection {
    /// User-editable persona prompt. Empty means "use the built-in default".
    pub system: String,
    /// Composed runtime value (base prompt plus slash-command appendix).
    /// Not serialized; computed by the loader.
    #[serde(skip)]
    pub resolved_system: String,
}

/// Overlay UI configuration. Holds window geometry and input attachment
/// limits. The collapsed-bar height and the close-animation deadline are
/// baked into the frontend (see `App.tsx`) because their effective range is
/// invisible to the user (collapsed height is overwritten by the
/// ResizeObserver within a frame; the hide delay sits below normal perception
/// across its usable range and creates a visible pop if dropped below the
/// exit-animation duration).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct WindowSection {
    /// Logical width of the overlay window.
    pub overlay_width: f64,
    /// Maximum height the expanded chat window is allowed to grow to.
    pub max_chat_height: f64,
    /// Maximum number of manually attached images per message. One additional
    /// image from /screen capture is allowed on top, for a total of
    /// max_images + 1 per message.
    pub max_images: u32,
}

impl Default for WindowSection {
    fn default() -> Self {
        Self {
            overlay_width: DEFAULT_OVERLAY_WIDTH,
            max_chat_height: DEFAULT_MAX_CHAT_HEIGHT,
            max_images: DEFAULT_MAX_IMAGES,
        }
    }
}

/// Selected-text quote display configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct QuoteSection {
    pub max_display_lines: u32,
    pub max_display_chars: u32,
    pub max_context_length: u32,
}

impl Default for QuoteSection {
    fn default() -> Self {
        Self {
            max_display_lines: DEFAULT_QUOTE_MAX_DISPLAY_LINES,
            max_display_chars: DEFAULT_QUOTE_MAX_DISPLAY_CHARS,
            max_context_length: DEFAULT_QUOTE_MAX_CONTEXT_LENGTH,
        }
    }
}

/// Chat provider configuration, driving main chat, vision, and `/think`.
///
/// API keys are NOT stored here (they live in the SQLite `app_config` table
/// under `api_key_openai` / `api_key_anthropic` / `api_key_openai_compatible`).
/// `base_url` empty means "use the provider default"; `openai_compatible`
/// requires a user-supplied URL.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ChatSection {
    /// Provider selector: `"openai"`, `"anthropic"`, or `"openai_compatible"`.
    pub provider: Provider,
    /// Model name sent to the provider.
    pub model: String,
    /// Base URL for the provider API. Empty means the provider default.
    pub base_url: String,
}

impl Default for ChatSection {
    fn default() -> Self {
        Self {
            provider: DEFAULT_CHAT_PROVIDER,
            model: DEFAULT_CHAT_MODEL.to_string(),
            base_url: DEFAULT_CHAT_BASE_URL.to_string(),
        }
    }
}

/// Agent mode (computer control) configuration, driving `/do`.
///
/// The active provider determines which cloud backend drives the agent loop;
/// only the OpenAI/Anthropic native tool-calling path is supported. API keys
/// live in the SQLite `app_config` table, not TOML.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct AgentSection {
    /// Provider selector: `"openai"`, `"anthropic"`, or `"openai_compatible"`.
    pub provider: Provider,
    /// Model name for the agent provider (e.g. "gpt-4o", "claude-sonnet-4-5").
    pub model: String,
    /// Base URL for the agent provider API. Empty means the provider default.
    pub base_url: String,
}

impl Default for AgentSection {
    fn default() -> Self {
        Self {
            provider: DEFAULT_AGENT_PROVIDER,
            model: DEFAULT_AGENT_MODEL.to_string(),
            base_url: DEFAULT_AGENT_BASE_URL.to_string(),
        }
    }
}

/// Top-level application configuration. Managed Tauri state; every subsystem
/// reads from `State<RwLock<AppConfig>>` and nowhere else. The loader resolves all
/// empty strings and out-of-bounds numerics to compiled defaults before the
/// `AppConfig` is installed, so every field here holds a usable value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct AppConfig {
    pub prompt: PromptSection,
    pub window: WindowSection,
    pub quote: QuoteSection,
    pub chat: ChatSection,
    pub agent: AgentSection,
}
