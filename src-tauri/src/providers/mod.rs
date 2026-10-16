//! Provider abstraction for multi-backend cloud LLM support.
//!
//! Routes requests to the correct backend (OpenAI, Anthropic, or an
//! OpenAI-compatible custom endpoint) based on user configuration. Each
//! provider implements the same streaming interface but translates messages
//! to its own API wire format.

pub mod anthropic;
pub mod openai;

use serde::{Deserialize, Serialize};

/// Supported LLM providers.
///
/// The wire selector strings are exactly `"openai"`, `"anthropic"`, and
/// `"openai_compatible"`; they are the values the frontend sends and the
/// values stored in `config.toml` under `[chat]` / `[agent]`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum Provider {
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "openai_compatible")]
    OpenAiCompatible,
}

impl Provider {
    /// Whether this provider requires a non-empty API key. OpenAI and
    /// Anthropic always do; a user-supplied OpenAI-compatible endpoint (a
    /// local server, for example) may not.
    pub fn requires_api_key(&self) -> bool {
        matches!(self, Provider::OpenAi | Provider::Anthropic)
    }

    /// The SQLite `app_config` key holding this provider's API key.
    pub fn api_key_setting(&self) -> &'static str {
        match self {
            Provider::OpenAi => "api_key_openai",
            Provider::Anthropic => "api_key_anthropic",
            Provider::OpenAiCompatible => "api_key_openai_compatible",
        }
    }
}

/// A tool call from a model response.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCall {
    /// Unique ID for the tool call (used to match results).
    pub id: String,
    /// The function/tool name (e.g., "computer_click").
    pub name: String,
    /// JSON string of arguments.
    pub arguments: String,
}

/// A structured, user-friendly error produced by a provider call.
///
/// `code` is a stable key the frontend localizes (see R1); `message` is raw
/// detail for logs and copy-paste. The exact set of codes is defined by the
/// `CODE_*` constants below and matches the frozen interface contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    /// Builds an `ApiError` from a stable code constant and a detail message.
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    /// Builds a `missing_api_key` error naming the provider's settings key.
    pub fn missing_api_key(key: &str) -> Self {
        Self::new(
            CODE_MISSING_API_KEY,
            format!("No API key configured ({key})."),
        )
    }
}

/// Stable error code: no API key is configured for the selected provider.
pub const CODE_MISSING_API_KEY: &str = "missing_api_key";
/// Stable error code: no chat model is configured for the selected provider.
pub const CODE_MISSING_MODEL: &str = "missing_model";
/// Stable error code: the API rejected the key (HTTP 401).
pub const CODE_UNAUTHORIZED: &str = "unauthorized";
/// Stable error code: the account is not permitted to use the model (HTTP 403).
pub const CODE_FORBIDDEN: &str = "forbidden";
/// Stable error code: rate limit exceeded (HTTP 429).
pub const CODE_RATE_LIMITED: &str = "rate_limited";
/// Stable error code: provider-side failure (HTTP 5xx / 529).
pub const CODE_SERVER_ERROR: &str = "server_error";
/// Stable error code: the request never reached a usable response.
pub const CODE_NETWORK: &str = "network";
/// Stable error code: the requested model does not exist (HTTP 404).
pub const CODE_MODEL_NOT_FOUND: &str = "model_not_found";
/// Stable error code: the request was rejected as malformed (HTTP 4xx).
pub const CODE_BAD_REQUEST: &str = "bad_request";
/// Stable error code: the conversation exceeded the model context window.
pub const CODE_CONTEXT_LENGTH_EXCEEDED: &str = "context_length_exceeded";
/// Stable error code: the user cancelled generation.
pub const CODE_CANCELLED: &str = "cancelled";
/// Stable error code: a selected skill's file could not be read. Surfaced as an
/// inline notice so a bad skill path never fails the whole turn (batch 3).
pub const CODE_SKILL_UNREADABLE: &str = "skill_unreadable";
/// Stable error code: an unclassified failure.
pub const CODE_UNKNOWN: &str = "unknown";

/// Maps an HTTP status (plus response body for context-length detection) to a
/// stable [`ApiError`]. Used by every HTTP provider so error-code mapping is
/// identical across OpenAI, Anthropic, and OpenAI-compatible endpoints.
pub fn classify_http_status(status: u16, body: &str) -> ApiError {
    // Providers signal an over-long prompt with a 400/413 whose body mentions
    // the context window. Surface that as its own code so the frontend can
    // suggest trimming the conversation rather than a generic "bad request".
    let lower = body.to_ascii_lowercase();
    if lower.contains("context_length")
        || lower.contains("context length")
        || lower.contains("maximum context")
        || lower.contains("too many tokens")
    {
        return ApiError::new(CODE_CONTEXT_LENGTH_EXCEEDED, friendly(status, body));
    }
    let code = match status {
        401 => CODE_UNAUTHORIZED,
        403 => CODE_FORBIDDEN,
        404 => CODE_MODEL_NOT_FOUND,
        429 => CODE_RATE_LIMITED,
        s if (500..600).contains(&s) => CODE_SERVER_ERROR,
        s if (400..500).contains(&s) => CODE_BAD_REQUEST,
        _ => CODE_UNKNOWN,
    };
    ApiError::new(code, friendly(status, body))
}

/// Maps a transport-level reqwest error to a stable [`ApiError`].
pub fn classify_transport_error(e: &reqwest::Error) -> ApiError {
    ApiError::new(CODE_NETWORK, e.to_string())
}

/// Formats a short, log-friendly detail string for an HTTP failure body.
fn friendly(status: u16, body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        format!("provider returned HTTP {status}")
    } else {
        let snippet: String = trimmed.chars().take(500).collect();
        format!("provider returned HTTP {status}: {snippet}")
    }
}

/// Detects the media type of a base64-encoded image by sniffing its magic
/// bytes. Falls back to `image/png` when the payload cannot be decoded, which
/// is also correct for the screenshot captures that dominate vision input.
///
/// Message image payloads carry raw base64 only (no `data:` prefix), because
/// the OpenAI and Anthropic wire formats need different framing; each provider
/// applies this helper to recover the media type.
pub fn image_media_type(base64_data: &str) -> &'static str {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .unwrap_or_default();
    media_type_from_magic(&bytes)
}

/// Maps image magic bytes to a media type. Unknown payloads fall back to PNG.
fn media_type_from_magic(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/png"
    }
}

/// Builds an OpenAI-style `data:` URI from raw base64 image data.
pub fn to_data_uri(base64_data: &str) -> String {
    format!(
        "data:{};base64,{}",
        image_media_type(base64_data),
        base64_data
    )
}

/// A chunk of streaming response from any provider.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ProviderChunk {
    /// A text token from the model.
    Token(String),
    /// A thinking/reasoning token.
    ThinkingToken(String),
    /// The model is requesting one or more tool calls.
    ToolCalls(Vec<ToolCall>),
    /// Streaming is complete.
    Done,
    /// Streaming was cancelled by the user.
    Cancelled,
    /// An error occurred.
    Error(ApiError),
}

/// Returns default base URLs for each provider. `openai_compatible` has no
/// default: the user must supply one.
pub fn default_base_url(provider: &Provider) -> &'static str {
    match provider {
        Provider::OpenAi => "https://api.openai.com/v1",
        Provider::Anthropic => "https://api.anthropic.com",
        Provider::OpenAiCompatible => "",
    }
}

/// Returns the suggested model list for each provider, used as a fallback when
/// the frontend has no cached datalist. `openai_compatible` has none because
/// the model name is entirely user-supplied.
pub fn default_models(provider: &Provider) -> &'static [&'static str] {
    match provider {
        Provider::OpenAi => &["gpt-4o", "gpt-4o-mini", "o4-mini", "gpt-4.1"],
        Provider::Anthropic => &["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
        Provider::OpenAiCompatible => &[],
    }
}

/// Resolves the effective base URL: the configured value when non-empty,
/// otherwise the provider default. `openai_compatible` with no configured URL
/// resolves to an empty string, which callers must treat as a configuration
/// error.
pub fn resolve_base_url(provider: &Provider, configured: &str) -> String {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        default_base_url(provider).to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_serialization() {
        assert_eq!(
            serde_json::to_string(&Provider::OpenAi).unwrap(),
            "\"openai\""
        );
        assert_eq!(
            serde_json::to_string(&Provider::Anthropic).unwrap(),
            "\"anthropic\""
        );
        assert_eq!(
            serde_json::to_string(&Provider::OpenAiCompatible).unwrap(),
            "\"openai_compatible\""
        );
    }

    #[test]
    fn provider_deserialization() {
        assert_eq!(
            serde_json::from_str::<Provider>("\"openai\"").unwrap(),
            Provider::OpenAi
        );
        assert_eq!(
            serde_json::from_str::<Provider>("\"anthropic\"").unwrap(),
            Provider::Anthropic
        );
        assert_eq!(
            serde_json::from_str::<Provider>("\"openai_compatible\"").unwrap(),
            Provider::OpenAiCompatible
        );
    }

    #[test]
    fn default_base_urls() {
        assert_eq!(
            default_base_url(&Provider::OpenAi),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            default_base_url(&Provider::Anthropic),
            "https://api.anthropic.com"
        );
        assert_eq!(default_base_url(&Provider::OpenAiCompatible), "");
    }

    #[test]
    fn default_models_match_contract() {
        assert_eq!(
            default_models(&Provider::OpenAi),
            &["gpt-4o", "gpt-4o-mini", "o4-mini", "gpt-4.1"]
        );
        assert_eq!(
            default_models(&Provider::Anthropic),
            &["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"]
        );
        assert!(default_models(&Provider::OpenAiCompatible).is_empty());
    }

    #[test]
    fn resolve_base_url_prefers_configured_value() {
        assert_eq!(
            resolve_base_url(&Provider::OpenAi, "https://proxy.example/v1"),
            "https://proxy.example/v1"
        );
    }

    #[test]
    fn resolve_base_url_falls_back_to_default() {
        assert_eq!(
            resolve_base_url(&Provider::Anthropic, "   "),
            "https://api.anthropic.com"
        );
        assert_eq!(resolve_base_url(&Provider::OpenAiCompatible, ""), "");
    }

    #[test]
    fn classify_http_status_maps_every_bucket() {
        assert_eq!(classify_http_status(401, "").code, CODE_UNAUTHORIZED);
        assert_eq!(classify_http_status(403, "").code, CODE_FORBIDDEN);
        assert_eq!(classify_http_status(404, "").code, CODE_MODEL_NOT_FOUND);
        assert_eq!(classify_http_status(429, "").code, CODE_RATE_LIMITED);
        assert_eq!(classify_http_status(500, "").code, CODE_SERVER_ERROR);
        assert_eq!(classify_http_status(529, "").code, CODE_SERVER_ERROR);
        assert_eq!(classify_http_status(400, "bad").code, CODE_BAD_REQUEST);
        assert_eq!(classify_http_status(418, "teapot").code, CODE_BAD_REQUEST);
        assert_eq!(classify_http_status(302, "").code, CODE_UNKNOWN);
    }

    #[test]
    fn classify_http_status_detects_context_length() {
        let err = classify_http_status(400, "This model's maximum context length is 8192 tokens");
        assert_eq!(err.code, CODE_CONTEXT_LENGTH_EXCEEDED);
    }

    #[test]
    fn classify_http_status_includes_body_snippet() {
        let err = classify_http_status(500, "upstream exploded");
        assert!(err.message.contains("500"));
        assert!(err.message.contains("upstream exploded"));

        let empty = classify_http_status(500, "   ");
        assert!(empty.message.contains("500"));
    }

    #[tokio::test]
    async fn classify_transport_error_is_network_code() {
        // An unsupported URL scheme makes reqwest fail at send time with a
        // `reqwest::Error` and no network access, exercising the classifier
        // deterministically offline.
        let client = reqwest::Client::new();
        let err = client
            .get("foo://unsupported-scheme")
            .send()
            .await
            .expect_err("unsupported scheme must error");
        assert_eq!(classify_transport_error(&err).code, CODE_NETWORK);
    }

    #[test]
    fn missing_api_key_error_uses_stable_code() {
        let err = ApiError::missing_api_key("api_key_openai");
        assert_eq!(err.code, CODE_MISSING_API_KEY);
        assert!(err.message.contains("api_key_openai"));
    }

    #[test]
    fn missing_model_code_matches_contract() {
        assert_eq!(CODE_MISSING_MODEL, "missing_model");
    }

    #[test]
    fn requires_api_key_only_for_hosted_providers() {
        assert!(Provider::OpenAi.requires_api_key());
        assert!(Provider::Anthropic.requires_api_key());
        assert!(!Provider::OpenAiCompatible.requires_api_key());
    }

    #[test]
    fn api_key_setting_names_match_contract() {
        assert_eq!(Provider::OpenAi.api_key_setting(), "api_key_openai");
        assert_eq!(Provider::Anthropic.api_key_setting(), "api_key_anthropic");
        assert_eq!(
            Provider::OpenAiCompatible.api_key_setting(),
            "api_key_openai_compatible"
        );
    }

    #[test]
    fn image_media_type_sniffs_png_and_jpeg() {
        use base64::Engine;
        // 1x1 PNG magic.
        let png = base64::engine::general_purpose::STANDARD
            .encode([0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        assert_eq!(image_media_type(&png), "image/png");
        // JPEG magic.
        let jpeg = base64::engine::general_purpose::STANDARD
            .encode([0xFFu8, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
        assert_eq!(image_media_type(&jpeg), "image/jpeg");
        // GIF magic.
        let gif = base64::engine::general_purpose::STANDARD.encode(b"GIF89a....");
        assert_eq!(image_media_type(&gif), "image/gif");
        // WEBP magic.
        let mut webp = b"RIFF".to_vec();
        webp.extend_from_slice(&[0, 0, 0, 0]);
        webp.extend_from_slice(b"WEBP");
        let webp = base64::engine::general_purpose::STANDARD.encode(&webp);
        assert_eq!(image_media_type(&webp), "image/webp");
    }

    #[test]
    fn image_media_type_falls_back_to_png_for_undecodable_input() {
        assert_eq!(image_media_type("not base64!!!"), "image/png");
    }

    #[test]
    fn to_data_uri_prefixes_media_type() {
        use base64::Engine;
        let jpeg = base64::engine::general_purpose::STANDARD.encode([0xFFu8, 0xD8, 0xFF]);
        let uri = to_data_uri(&jpeg);
        assert!(uri.starts_with("data:image/jpeg;base64,"));
        assert!(uri.ends_with(&jpeg));
    }
}
