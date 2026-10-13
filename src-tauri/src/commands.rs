//! Chat command surface: the provider-agnostic `ask` streaming command plus
//! the shared generation/conversation state and settings persistence commands.
//!
//! `ask` is the single entry point for main chat, vision (attached images and
//! `/screen` captures), and `/think` reasoning. It resolves the `[chat]`
//! provider from config, reads the API key from SQLite, and streams provider
//! chunks back to the frontend as [`StreamChunk`]s. All user-facing error copy
//! is conveyed as a stable [`ApiError::code`] the frontend localizes.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};
use tokio_util::sync::CancellationToken;

use crate::config::AppConfig;
use crate::providers::{self, ApiError, Provider, ProviderChunk};

/// Payload emitted back to the frontend per stream event.
///
/// `code` (inside the `Error` arm) is a stable key the frontend maps to
/// localized copy; the `message` is raw detail for logs and copy-to-clipboard.
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "type", content = "data")]
pub enum StreamChunk {
    /// A single token chunk string.
    Token(String),
    /// A single thinking/reasoning token chunk string.
    ThinkingToken(String),
    /// A structured, stable error that occurred during processing.
    Error(ApiError),
    /// Indicates the stream has fully completed.
    Done,
    /// The user explicitly cancelled generation.
    Cancelled,
}

/// A single message in the provider-agnostic conversation format.
///
/// The optional `images` field carries base64-encoded image data (no `data:`
/// prefix) for multimodal models. When absent or empty, the message is
/// text-only.
#[derive(Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

/// Holds the active cancellation token for the current generation request.
///
/// Only one generation runs at a time — starting a new request replaces the
/// previous token. `cancel_generation` cancels whatever is currently active.
#[derive(Default)]
pub struct GenerationState {
    token: Mutex<Option<CancellationToken>>,
}

impl GenerationState {
    /// Creates a new empty generation state with no active token.
    pub fn new() -> Self {
        Self {
            token: Mutex::new(None),
        }
    }

    /// Stores a new cancellation token, replacing any previous one.
    fn set(&self, token: CancellationToken) {
        *self.token.lock().unwrap() = Some(token);
    }

    /// Cancels the active generation, if any, and clears the stored token.
    pub fn cancel(&self) {
        if let Some(token) = self.token.lock().unwrap().take() {
            token.cancel();
        }
    }

    /// Clears the stored token without cancelling it (used on natural completion).
    fn clear(&self) {
        *self.token.lock().unwrap() = None;
    }
}

/// Backend-managed conversation history with an epoch counter to prevent
/// stale writes after a reset. The Rust side is the source of truth; the
/// frontend sends only new user messages and receives streamed tokens.
pub struct ConversationHistory {
    pub messages: Mutex<Vec<ChatMessage>>,
    pub epoch: AtomicU64,
}

impl Default for ConversationHistory {
    fn default() -> Self {
        Self {
            messages: Mutex::new(Vec::new()),
            epoch: AtomicU64::new(0),
        }
    }
}

impl ConversationHistory {
    /// Creates a new empty conversation history at epoch 0.
    pub fn new() -> Self {
        Self::default()
    }
}

// ─── Provider resolution ──────────────────────────────────────────────────────

/// A fully-resolved provider invocation: the [`Provider`] and its model,
/// base URL, and API key. Secrets live only here for the duration of a turn.
#[derive(Clone, Debug)]
pub struct ChatProviderConfig {
    pub provider: Provider,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}

/// Resolves the `[chat]` provider from config plus the API key from the
/// SQLite `app_config` table. Returns a stable [`ApiError`] when the
/// configuration is incomplete (no model, no base URL, or a missing key for a
/// provider that requires one).
pub fn resolve_chat_provider(
    config: &AppConfig,
    conn: &rusqlite::Connection,
) -> Result<ChatProviderConfig, ApiError> {
    resolve_provider(
        &config.chat.provider,
        &config.chat.model,
        &config.chat.base_url,
        conn,
    )
}

/// Resolves the `[agent]` provider from config plus the API key from the
/// SQLite `app_config` table. Same validation rules as [`resolve_chat_provider`].
pub fn resolve_agent_provider(
    config: &AppConfig,
    conn: &rusqlite::Connection,
) -> Result<ChatProviderConfig, ApiError> {
    resolve_provider(
        &config.agent.provider,
        &config.agent.model,
        &config.agent.base_url,
        conn,
    )
}

/// Shared provider resolution for a config section. Returns a stable
/// [`ApiError`] when the section is incomplete.
fn resolve_provider(
    provider: &Provider,
    model: &str,
    configured_base_url: &str,
    conn: &rusqlite::Connection,
) -> Result<ChatProviderConfig, ApiError> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err(ApiError::new(
            providers::CODE_BAD_REQUEST,
            "No model configured for the selected provider.",
        ));
    }
    let base_url = providers::resolve_base_url(provider, configured_base_url);
    if base_url.is_empty() {
        return Err(ApiError::new(
            providers::CODE_BAD_REQUEST,
            "No base URL configured for the selected provider.",
        ));
    }
    let api_key = crate::database::get_config(conn, provider.api_key_setting())
        .map_err(|e| ApiError::new(providers::CODE_UNKNOWN, e.to_string()))?
        .unwrap_or_default();
    if provider.requires_api_key() && api_key.trim().is_empty() {
        return Err(ApiError::missing_api_key(provider.api_key_setting()));
    }
    Ok(ChatProviderConfig {
        provider: provider.clone(),
        model,
        base_url,
        api_key,
    })
}

/// Maps a provider chunk to the frontend-facing [`StreamChunk`]. `ToolCalls`
/// never surface on the chat path (tools are disabled there) and map to
/// `None`, so the caller drops them.
fn map_provider_chunk(chunk: ProviderChunk) -> Option<StreamChunk> {
    Some(match chunk {
        ProviderChunk::Token(t) => StreamChunk::Token(t),
        ProviderChunk::ThinkingToken(t) => StreamChunk::ThinkingToken(t),
        ProviderChunk::Error(e) => StreamChunk::Error(e),
        ProviderChunk::Done => StreamChunk::Done,
        ProviderChunk::Cancelled => StreamChunk::Cancelled,
        ProviderChunk::ToolCalls(_) => return None,
    })
}

/// Streams one provider turn and returns the accumulated assistant text.
/// Provider chunks are mapped to [`StreamChunk`]s and handed to `emit`.
///
/// Errors are surfaced both as a `ProviderChunk::Error` (already forwarded to
/// `emit`) and as the returned empty string; the caller does not need to
/// inspect the return value to know a failure happened.
///
/// `emit` is `Send` so the whole future can run on Tauri's async runtime.
pub async fn stream_chat<F>(
    cfg: &ChatProviderConfig,
    system_prompt: &str,
    messages: Vec<ChatMessage>,
    think: bool,
    client: &reqwest::Client,
    cancel_token: CancellationToken,
    emit: &mut F,
) -> String
where
    F: FnMut(StreamChunk) + Send,
{
    let mut on_provider = |pc: ProviderChunk| {
        if let Some(chunk) = map_provider_chunk(pc) {
            emit(chunk);
        }
    };

    let result = match cfg.provider {
        Provider::Anthropic => {
            providers::anthropic::stream_anthropic_chat(
                &cfg.base_url,
                &cfg.model,
                &cfg.api_key,
                system_prompt,
                messages,
                false,
                think,
                1920,
                1080,
                client,
                cancel_token.clone(),
                &mut on_provider,
            )
            .await
        }
        Provider::OpenAi | Provider::OpenAiCompatible => {
            providers::openai::stream_openai_chat(
                &cfg.base_url,
                &cfg.model,
                &cfg.api_key,
                messages,
                false,
                think,
                client,
                cancel_token.clone(),
                &mut on_provider,
            )
            .await
        }
    };

    result.unwrap_or_default()
}

// ─── Settings persistence ─────────────────────────────────────────────────────

/// Returns all settings from the app_config table as a JSON object.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn get_settings(db: State<'_, crate::history::Database>) -> Result<serde_json::Value, String> {
    let conn =
        db.0.lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    let mut settings = serde_json::Map::new();

    let mut stmt = conn
        .prepare("SELECT key, value FROM app_config")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        settings.insert(key, serde_json::Value::String(value));
    }

    Ok(serde_json::Value::Object(settings))
}

/// Sets a single setting in the app_config table.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn set_setting(
    key: String,
    value: String,
    db: State<'_, crate::history::Database>,
) -> Result<(), String> {
    let conn =
        db.0.lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    crate::database::set_config(&conn, &key, &value).map_err(|e| e.to_string())
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

/// Streams a chat response from the configured cloud provider.
///
/// Handles main chat, vision (attached `images` and `/screen` captures), and
/// `/think` reasoning. Appends the user message and assistant response to
/// conversation history after completion or cancellation (retaining context
/// for follow-up requests). Uses an epoch counter to prevent stale writes
/// after a reset.
///
/// - `query` is the user's message text.
/// - `context` is optional highlighted text, prefixed into the prompt.
/// - `images` are absolute file paths to attached images; the backend
///   base64-encodes them for the provider's vision input.
/// - `think` requests the provider's reasoning mode.
/// - `prompt_override`, when present, replaces the text actually sent to the
///   provider (the chat bubble still shows `query`).
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn ask(
    query: String,
    context: Option<String>,
    images: Option<Vec<String>>,
    think: Option<bool>,
    prompt_override: Option<String>,
    on_event: Channel<StreamChunk>,
    client: State<'_, reqwest::Client>,
    generation: State<'_, GenerationState>,
    history: State<'_, ConversationHistory>,
    config: State<'_, parking_lot::RwLock<AppConfig>>,
    db: State<'_, crate::history::Database>,
) -> Result<(), String> {
    let think = think.unwrap_or(false);

    // Resolve the provider + API key while holding both the config read guard
    // and the DB lock; both are dropped before any `.await`.
    let resolved = {
        let guard = config.read();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        resolve_chat_provider(&guard, &conn)
    };
    let cfg = match resolved {
        Ok(cfg) => cfg,
        Err(err) => {
            let _ = on_event.send(StreamChunk::Error(err));
            return Ok(());
        }
    };
    let system_prompt = config.read().prompt.resolved_system.clone();

    // Build the user message. When quoted text is present, label it explicitly
    // so the model knows the highlighted text is the primary subject and any
    // attached images provide surrounding context.
    let actual_prompt = prompt_override.unwrap_or(query);
    let content = match context {
        Some(ref qt) if !qt.trim().is_empty() => {
            format!("[Highlighted Text]\n\"{qt}\"\n\n[Request]\n{actual_prompt}")
        }
        _ => actual_prompt,
    };

    let encoded_images = match images {
        Some(ref paths) if !paths.is_empty() => {
            Some(crate::images::encode_images_as_base64(paths)?)
        }
        _ => None,
    };

    let user_msg = ChatMessage {
        role: "user".to_string(),
        content,
        images: encoded_images,
    };

    // Snapshot the current epoch and build the messages array. The user
    // message is NOT yet committed to history — it is only added after a
    // response (including partial/cancelled) to prevent orphaned messages on
    // errors.
    let (epoch_at_start, messages) = {
        let conv = history.messages.lock().unwrap();
        let epoch = history.epoch.load(Ordering::SeqCst);
        let mut msgs = vec![ChatMessage {
            role: "system".to_string(),
            content: system_prompt.clone(),
            images: None,
        }];
        msgs.extend(conv.clone());
        msgs.push(user_msg.clone());
        (epoch, msgs)
    };

    let cancel_token = CancellationToken::new();
    generation.set(cancel_token.clone());

    let accumulated = stream_chat(
        &cfg,
        &system_prompt,
        messages,
        think,
        &client,
        cancel_token.clone(),
        &mut |chunk| {
            let _ = on_event.send(chunk);
        },
    )
    .await;

    // Persist user + assistant messages to in-memory history when the epoch
    // has not changed (no reset during streaming) and we received content.
    // This includes cancelled generations so that subsequent requests retain
    // the conversational context (the user message and any partial response).
    let current_epoch = history.epoch.load(Ordering::SeqCst);
    if current_epoch == epoch_at_start && !accumulated.is_empty() {
        let mut conv = history.messages.lock().unwrap();
        conv.push(user_msg);
        conv.push(ChatMessage {
            role: "assistant".to_string(),
            content: accumulated,
            images: None,
        });
    }

    generation.clear();
    Ok(())
}

/// Cancels the currently active generation, if any.
///
/// Signals the `CancellationToken` stored in `GenerationState`, which causes the
/// provider stream loop to exit immediately and drop the HTTP connection.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub async fn cancel_generation(generation: State<'_, GenerationState>) -> Result<(), String> {
    generation.cancel();
    Ok(())
}

/// Clears the backend conversation history and increments the epoch counter.
/// The epoch increment prevents any in-flight `ask` from writing stale
/// messages into the freshly cleared history.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn reset_conversation(history: State<'_, ConversationHistory>) {
    history.epoch.fetch_add(1, Ordering::SeqCst);
    history.messages.lock().unwrap().clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    fn collect_chunks() -> (Arc<StdMutex<Vec<StreamChunk>>>, impl FnMut(StreamChunk)) {
        let chunks: Arc<StdMutex<Vec<StreamChunk>>> = Arc::new(StdMutex::new(Vec::new()));
        let chunks_clone = chunks.clone();
        let callback = move |chunk: StreamChunk| {
            chunks_clone.lock().unwrap().push(chunk);
        };
        (chunks, callback)
    }

    fn openai_cfg(base_url: &str) -> ChatProviderConfig {
        ChatProviderConfig {
            provider: Provider::OpenAi,
            model: "gpt-4o".to_string(),
            base_url: base_url.to_string(),
            api_key: "sk-test".to_string(),
        }
    }

    // ─── GenerationState ──────────────────────────────────────────────────────

    #[test]
    fn generation_state_set_and_cancel() {
        let state = GenerationState::new();
        let token = CancellationToken::new();
        let token_clone = token.clone();

        state.set(token);
        assert!(!token_clone.is_cancelled());

        state.cancel();
        assert!(token_clone.is_cancelled());
    }

    #[test]
    fn generation_state_cancel_when_empty() {
        let state = GenerationState::new();
        state.cancel();
    }

    #[test]
    fn generation_state_clear_does_not_cancel() {
        let state = GenerationState::new();
        let token = CancellationToken::new();
        let token_clone = token.clone();

        state.set(token);
        state.clear();
        assert!(!token_clone.is_cancelled());
    }

    #[test]
    fn generation_state_set_replaces_previous() {
        let state = GenerationState::new();
        let first = CancellationToken::new();
        let first_clone = first.clone();
        let second = CancellationToken::new();
        let second_clone = second.clone();

        state.set(first);
        state.set(second);

        state.cancel();
        assert!(!first_clone.is_cancelled());
        assert!(second_clone.is_cancelled());
    }

    // ─── ConversationHistory ──────────────────────────────────────────────────

    #[test]
    fn conversation_history_new_starts_at_epoch_zero() {
        let h = ConversationHistory::new();
        assert_eq!(h.epoch.load(Ordering::SeqCst), 0);
        assert!(h.messages.lock().unwrap().is_empty());
    }

    #[test]
    fn conversation_history_epoch_increments_on_clear() {
        let h = ConversationHistory::new();
        h.messages.lock().unwrap().push(ChatMessage {
            role: "user".to_string(),
            content: "hi".to_string(),
            images: None,
        });

        h.epoch.fetch_add(1, Ordering::SeqCst);
        h.messages.lock().unwrap().clear();

        assert_eq!(h.epoch.load(Ordering::SeqCst), 1);
        assert!(h.messages.lock().unwrap().is_empty());
    }

    // ─── map_provider_chunk ───────────────────────────────────────────────────

    #[test]
    fn map_provider_chunk_maps_every_chat_variant() {
        assert_eq!(
            map_provider_chunk(ProviderChunk::Token("a".to_string())),
            Some(StreamChunk::Token("a".to_string()))
        );
        assert_eq!(
            map_provider_chunk(ProviderChunk::ThinkingToken("t".to_string())),
            Some(StreamChunk::ThinkingToken("t".to_string()))
        );
        assert_eq!(
            map_provider_chunk(ProviderChunk::Done),
            Some(StreamChunk::Done)
        );
        assert_eq!(
            map_provider_chunk(ProviderChunk::Cancelled),
            Some(StreamChunk::Cancelled)
        );
        let err = ApiError::new(providers::CODE_NETWORK, "down");
        assert_eq!(
            map_provider_chunk(ProviderChunk::Error(err.clone())),
            Some(StreamChunk::Error(err))
        );
    }

    #[test]
    fn map_provider_chunk_drops_tool_calls() {
        assert_eq!(map_provider_chunk(ProviderChunk::ToolCalls(vec![])), None);
    }

    #[test]
    fn stream_chunk_serializes_with_type_and_data_tags() {
        let json = serde_json::to_value(StreamChunk::ThinkingToken("x".to_string())).unwrap();
        assert_eq!(json["type"], "ThinkingToken");
        assert_eq!(json["data"], "x");

        let json = serde_json::to_value(StreamChunk::Done).unwrap();
        assert_eq!(json["type"], "Done");

        let json = serde_json::to_value(StreamChunk::Error(ApiError::new(
            providers::CODE_RATE_LIMITED,
            "slow down",
        )))
        .unwrap();
        assert_eq!(json["type"], "Error");
        assert_eq!(json["data"]["code"], providers::CODE_RATE_LIMITED);
        assert_eq!(json["data"]["message"], "slow down");
    }

    // ─── resolve_chat_provider ────────────────────────────────────────────────

    fn config_with_chat(provider: Provider, model: &str, base_url: &str) -> AppConfig {
        let mut config = AppConfig::default();
        config.chat.provider = provider;
        config.chat.model = model.to_string();
        config.chat.base_url = base_url.to_string();
        config
    }

    #[test]
    fn resolve_rejects_empty_model() {
        let conn = crate::database::open_in_memory().unwrap();
        let config = config_with_chat(Provider::OpenAi, "   ", "");
        let err = resolve_chat_provider(&config, &conn).unwrap_err();
        assert_eq!(err.code, providers::CODE_BAD_REQUEST);
    }

    #[test]
    fn resolve_rejects_empty_base_url_for_compatible() {
        let conn = crate::database::open_in_memory().unwrap();
        let config = config_with_chat(Provider::OpenAiCompatible, "local", "");
        let err = resolve_chat_provider(&config, &conn).unwrap_err();
        assert_eq!(err.code, providers::CODE_BAD_REQUEST);
    }

    #[test]
    fn resolve_reports_missing_api_key_for_hosted_providers() {
        let conn = crate::database::open_in_memory().unwrap();
        let config = config_with_chat(Provider::OpenAi, "gpt-4o", "");
        let err = resolve_chat_provider(&config, &conn).unwrap_err();
        assert_eq!(err.code, providers::CODE_MISSING_API_KEY);
        assert!(err.message.contains("api_key_openai"));
    }

    #[test]
    fn resolve_uses_provider_default_base_url() {
        let conn = crate::database::open_in_memory().unwrap();
        crate::database::set_config(&conn, "api_key_openai", "sk-abc").unwrap();
        let config = config_with_chat(Provider::OpenAi, "gpt-4o", "");
        let resolved = resolve_chat_provider(&config, &conn).unwrap();
        assert_eq!(resolved.base_url, "https://api.openai.com/v1");
        assert_eq!(resolved.api_key, "sk-abc");
    }

    #[test]
    fn resolve_allows_keyless_openai_compatible() {
        let conn = crate::database::open_in_memory().unwrap();
        let config = config_with_chat(
            Provider::OpenAiCompatible,
            "local",
            "http://localhost:1234/v1",
        );
        let resolved = resolve_chat_provider(&config, &conn).unwrap();
        assert!(resolved.api_key.is_empty());
        assert_eq!(resolved.base_url, "http://localhost:1234/v1");
    }

    #[test]
    fn resolve_agent_provider_reads_agent_section() {
        let conn = crate::database::open_in_memory().unwrap();
        crate::database::set_config(&conn, "api_key_anthropic", "sk-ant").unwrap();
        let mut config = AppConfig::default();
        config.agent.provider = Provider::Anthropic;
        config.agent.model = "claude-sonnet-4-5".to_string();
        let resolved = resolve_agent_provider(&config, &conn).unwrap();
        assert_eq!(resolved.provider, Provider::Anthropic);
        assert_eq!(resolved.model, "claude-sonnet-4-5");
        assert_eq!(resolved.base_url, "https://api.anthropic.com");
        assert_eq!(resolved.api_key, "sk-ant");
    }

    #[test]
    fn resolve_agent_provider_reports_missing_model() {
        let conn = crate::database::open_in_memory().unwrap();
        // Default agent model is empty.
        let config = AppConfig::default();
        let err = resolve_agent_provider(&config, &conn).unwrap_err();
        assert_eq!(err.code, providers::CODE_BAD_REQUEST);
    }

    // ─── stream_chat (request shaping + chunk mapping) ────────────────────────

    #[tokio::test]
    async fn stream_chat_openai_maps_tokens_and_done() {
        let mut server = mockito::Server::new_async().await;
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n\
                    data: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let mock = server
            .mock("POST", "/chat/completions")
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "model": "gpt-4o",
                "stream": true
            })))
            .with_body(body)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let (chunks, mut emit) = collect_chunks();
        let cfg = openai_cfg(&server.url());
        let accumulated = stream_chat(
            &cfg,
            "system",
            vec![ChatMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
                images: None,
            }],
            false,
            &client,
            CancellationToken::new(),
            &mut emit,
        )
        .await;

        mock.assert_async().await;
        assert_eq!(accumulated, "Hello");
        let chunks = chunks.lock().unwrap();
        assert!(matches!(&chunks[0], StreamChunk::Token(t) if t == "Hel"));
        assert!(matches!(&chunks[1], StreamChunk::Token(t) if t == "lo"));
        assert!(matches!(&chunks[2], StreamChunk::Done));
    }

    #[tokio::test]
    async fn stream_chat_anthropic_sends_system_prompt_and_maps_thinking() {
        let mut server = mockito::Server::new_async().await;
        let body = "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"plan\"}}\n\n\
                    data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n\
                    data: {\"type\":\"message_stop\"}\n\n";
        let mock = server
            .mock("POST", "/v1/messages")
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "model": "claude-sonnet-4-5",
                "system": "be brief",
                "thinking": { "type": "enabled" }
            })))
            .with_body(body)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let (chunks, mut emit) = collect_chunks();
        let mut cfg = openai_cfg(&server.url());
        cfg.provider = Provider::Anthropic;
        cfg.model = "claude-sonnet-4-5".to_string();
        cfg.api_key = "sk-ant".to_string();

        let accumulated = stream_chat(
            &cfg,
            "be brief",
            vec![ChatMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
                images: None,
            }],
            true,
            &client,
            CancellationToken::new(),
            &mut emit,
        )
        .await;

        mock.assert_async().await;
        assert_eq!(accumulated, "Hi");
        let chunks = chunks.lock().unwrap();
        assert!(matches!(&chunks[0], StreamChunk::ThinkingToken(t) if t == "plan"));
        assert!(matches!(&chunks[1], StreamChunk::Token(t) if t == "Hi"));
    }

    #[tokio::test]
    async fn stream_chat_maps_http_error_to_stream_chunk() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .with_status(429)
            .with_body("rate limited")
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let (chunks, mut emit) = collect_chunks();
        let cfg = openai_cfg(&server.url());
        let accumulated = stream_chat(
            &cfg,
            "system",
            vec![],
            false,
            &client,
            CancellationToken::new(),
            &mut emit,
        )
        .await;

        mock.assert_async().await;
        assert!(accumulated.is_empty());
        let chunks = chunks.lock().unwrap();
        assert!(
            matches!(&chunks[0], StreamChunk::Error(e) if e.code == providers::CODE_RATE_LIMITED)
        );
    }
}
