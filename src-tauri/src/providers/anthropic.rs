//! Anthropic provider for streaming messages with vision, extended thinking,
//! and computer use.
//!
//! Implements the Anthropic Messages API with SSE streaming, the
//! `computer_20250124` tool type, image content blocks, extended thinking
//! (`thinking_delta`), and converts responses to the unified
//! [`ProviderChunk`] format.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::{
    classify_http_status, classify_transport_error, image_media_type, ApiError, ProviderChunk,
    ToolCall,
};

/// Extended-thinking token budget when `/think` is enabled.
const THINKING_BUDGET_TOKENS: u32 = 2048;
/// `max_tokens` for a normal (non-thinking) turn.
const DEFAULT_MAX_TOKENS: u32 = 4096;
/// `max_tokens` for a thinking turn. Must exceed `THINKING_BUDGET_TOKENS`.
const THINKING_MAX_TOKENS: u32 = 8192;

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<AnthropicTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<AnthropicThinking>,
    stream: bool,
}

#[derive(Serialize, Clone)]
#[serde(tag = "role")]
enum AnthropicMessage {
    #[serde(rename = "user")]
    User { content: Value },
    #[serde(rename = "assistant")]
    Assistant { content: Value },
}

#[derive(Serialize)]
struct AnthropicThinking {
    r#type: String,
    budget_tokens: u32,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum AnthropicTool {
    #[serde(rename = "computer_20250124")]
    Computer20250124 {
        name: String,
        display_width_px: u32,
        display_height_px: u32,
    },
}

// ─── SSE streaming types ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    content_block: Option<AnthropicStreamContentBlock>,
    delta: Option<AnthropicStreamDelta>,
}

#[derive(Deserialize)]
struct AnthropicStreamContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    id: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicStreamDelta {
    text: Option<String>,
    thinking: Option<String>,
    partial_json: Option<String>,
}

// ─── Computer use tool ─────────────────────────────────────────────────────────

/// Returns the Anthropic computer_use tool definition with standard screen dimensions.
pub fn anthropic_computer_tool(width: u32, height: u32) -> Vec<AnthropicTool> {
    vec![AnthropicTool::Computer20250124 {
        name: "computer".to_string(),
        display_width_px: width,
        display_height_px: height,
    }]
}

// ─── Message translation ────────────────────────────────────────────────────────

/// Builds an Anthropic image content block from raw base64 image data,
/// sniffing the media type from the payload's magic bytes.
fn image_block(base64_data: &str) -> Value {
    serde_json::json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": image_media_type(base64_data),
            "data": base64_data,
        },
    })
}

/// Translates the internal conversation into Anthropic messages. System
/// messages are dropped here (Anthropic carries the system prompt as a
/// top-level field). Images ride on the message that owns them (attached
/// images and the agent's screenshot both live in `message.images`), so no
/// separate screenshot argument is needed — that would duplicate the capture
/// on every turn.
fn to_anthropic_messages(messages: &[crate::commands::ChatMessage]) -> Vec<AnthropicMessage> {
    let mut out: Vec<AnthropicMessage> = Vec::new();
    for m in messages {
        if m.role == "system" {
            continue;
        }

        let mut content_parts: Vec<Value> = Vec::new();
        if !m.content.is_empty() {
            content_parts.push(serde_json::json!({ "type": "text", "text": m.content }));
        }
        if let Some(ref imgs) = m.images {
            for img in imgs {
                content_parts.push(image_block(img));
            }
        }

        let content = if content_parts.len() == 1 {
            content_parts.into_iter().next().unwrap()
        } else {
            Value::Array(content_parts)
        };

        if m.role == "user" {
            out.push(AnthropicMessage::User { content });
        } else {
            out.push(AnthropicMessage::Assistant { content });
        }
    }
    out
}

// ─── Streaming chat ────────────────────────────────────────────────────────────

/// Streams a message from the Anthropic Messages API.
///
/// Sends the conversation with optional computer-use tool, optional extended
/// thinking, and streams the response, emitting [`ProviderChunk`] variants via
/// the `on_chunk` callback.
///
/// Images (attached files and the agent's screenshot) travel inside
/// `messages[i].images`; there is no separate screenshot argument, so a
/// screenshot attached to the final user message is sent exactly once.
#[allow(clippy::too_many_arguments)]
pub async fn stream_anthropic_chat(
    base_url: &str,
    model: &str,
    api_key: &str,
    system_prompt: &str,
    messages: Vec<crate::commands::ChatMessage>,
    include_tools: bool,
    think: bool,
    screen_width: u32,
    screen_height: u32,
    client: &reqwest::Client,
    cancel_token: CancellationToken,
    mut on_chunk: impl FnMut(ProviderChunk),
) -> Result<String, ApiError> {
    if api_key.trim().is_empty() {
        let err = ApiError::missing_api_key("api_key_anthropic");
        on_chunk(ProviderChunk::Error(err.clone()));
        return Err(err);
    }

    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));

    let anthropic_messages = to_anthropic_messages(&messages);

    let tools = if include_tools {
        anthropic_computer_tool(screen_width, screen_height)
    } else {
        vec![]
    };

    let request = AnthropicRequest {
        model: model.to_string(),
        max_tokens: if think {
            THINKING_MAX_TOKENS
        } else {
            DEFAULT_MAX_TOKENS
        },
        messages: anthropic_messages,
        tools,
        thinking: think.then(|| AnthropicThinking {
            r#type: "enabled".to_string(),
            budget_tokens: THINKING_BUDGET_TOKENS,
        }),
        stream: true,
    };

    // Anthropic requires the system prompt as a top-level field, which the
    // typed request struct does not model; inject it into the serialized body.
    // `AnthropicRequest` is a plain data struct, so serialization is infallible.
    let mut body = serde_json::to_value(&request).expect("request serializes to object");
    if !system_prompt.is_empty() {
        body.as_object_mut()
            .expect("request serializes to object")
            .insert(
                "system".to_string(),
                Value::String(system_prompt.to_string()),
            );
    }

    let response = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let err = classify_transport_error(&e);
            on_chunk(ProviderChunk::Error(err.clone()));
            err
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let err = classify_http_status(status, &body);
        on_chunk(ProviderChunk::Error(err.clone()));
        return Err(err);
    }

    let mut stream = response.bytes_stream();
    let mut accumulated = String::new();
    let mut current_tool_id = String::new();
    let mut current_tool_name = String::new();
    let mut current_tool_args = String::new();
    // Raw byte buffer carried across network chunks; SSE frames are newline
    // delimited and a frame (or a single UTF-8 codepoint) may be split across
    // chunks, so only complete lines are decoded. `0x0A` never appears inside a
    // UTF-8 multibyte sequence, so a complete line always ends on a boundary.
    let mut buffer: Vec<u8> = Vec::new();

    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                on_chunk(ProviderChunk::Cancelled);
                return Ok(accumulated);
            }
            chunk_opt = stream.next() => {
                match chunk_opt {
                    Some(Ok(bytes)) => {
                        buffer.extend_from_slice(&bytes);
                        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                            let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                            let line = String::from_utf8_lossy(&line_bytes);
                            let line = line.trim();
                            let Some(data) = line.strip_prefix("data: ") else {
                                continue;
                            };
                            if data == "[DONE]" {
                                if !current_tool_id.is_empty() {
                                    on_chunk(ProviderChunk::ToolCalls(vec![drain_tool_call(
                                        &mut current_tool_id,
                                        &mut current_tool_name,
                                        &mut current_tool_args,
                                    )]));
                                }
                                on_chunk(ProviderChunk::Done);
                                return Ok(accumulated);
                            }

                            let Ok(event) = serde_json::from_str::<AnthropicStreamEvent>(data) else {
                                continue;
                            };
                            match event.event_type.as_str() {
                                "content_block_start" => {
                                    if let Some(block) = event.content_block {
                                        if block.block_type == "tool_use" {
                                            current_tool_id = block.id.unwrap_or_default();
                                            current_tool_name = block.name.unwrap_or_default();
                                            current_tool_args.clear();
                                        }
                                    }
                                }
                                "content_block_delta" => {
                                    if let Some(delta) = event.delta {
                                        if let Some(thinking) = delta.thinking {
                                            if !thinking.is_empty() {
                                                on_chunk(ProviderChunk::ThinkingToken(thinking));
                                            }
                                        }
                                        if let Some(text) = delta.text {
                                            if !text.is_empty() {
                                                accumulated.push_str(&text);
                                                on_chunk(ProviderChunk::Token(text));
                                            }
                                        }
                                        if let Some(partial_json) = delta.partial_json {
                                            current_tool_args.push_str(&partial_json);
                                        }
                                    }
                                }
                                "content_block_stop" => {
                                    if !current_tool_id.is_empty() {
                                        on_chunk(ProviderChunk::ToolCalls(vec![drain_tool_call(
                                            &mut current_tool_id,
                                            &mut current_tool_name,
                                            &mut current_tool_args,
                                        )]));
                                    }
                                }
                                "message_stop" => {
                                    on_chunk(ProviderChunk::Done);
                                    return Ok(accumulated);
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let err = classify_transport_error(&e);
                        on_chunk(ProviderChunk::Error(err.clone()));
                        return Err(err);
                    }
                    None => {
                        on_chunk(ProviderChunk::Done);
                        return Ok(accumulated);
                    }
                }
            }
        }
    }
}

/// Materializes the in-progress tool call and clears the accumulator slots.
fn drain_tool_call(id: &mut String, name: &mut String, args: &mut String) -> ToolCall {
    ToolCall {
        id: std::mem::take(id),
        name: std::mem::take(name),
        arguments: std::mem::take(args),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::ChatMessage;

    fn user(content: &str, images: Option<Vec<String>>) -> ChatMessage {
        ChatMessage {
            role: "user".to_string(),
            content: content.to_string(),
            images,
        }
    }

    #[test]
    fn anthropic_computer_tool_creation() {
        let tools = anthropic_computer_tool(1920, 1080);
        assert_eq!(tools.len(), 1);
        let json = serde_json::to_string(&tools[0]).unwrap();
        assert!(json.contains("computer_20250124"));
        assert!(json.contains("1920"));
        assert!(json.contains("1080"));
    }

    #[test]
    fn anthropic_message_serialization() {
        let msg = AnthropicMessage::User {
            content: serde_json::json!("Hello"),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"role\":\"user\""));
    }

    #[test]
    fn system_messages_are_dropped() {
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "sys".to_string(),
                images: None,
            },
            user("hi", None),
        ];
        let out = to_anthropic_messages(&messages);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn image_block_sniffs_jpeg_media_type() {
        use base64::Engine;
        let jpeg = base64::engine::general_purpose::STANDARD.encode([0xFFu8, 0xD8, 0xFF]);
        let block = image_block(&jpeg);
        assert_eq!(block["type"], "image");
        assert_eq!(block["source"]["type"], "base64");
        assert_eq!(block["source"]["media_type"], "image/jpeg");
    }

    #[test]
    fn message_with_images_uses_content_parts() {
        use base64::Engine;
        let png = base64::engine::general_purpose::STANDARD.encode([0x89u8, 0x50, 0x4E, 0x47]);
        let out = to_anthropic_messages(&[user("look", Some(vec![png]))]);
        let json = serde_json::to_value(&out[0]).unwrap();
        let parts = json["content"].as_array().expect("parts");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["type"], "image");
    }

    #[test]
    fn images_are_sent_once_per_message_that_owns_them() {
        use base64::Engine;
        let png = base64::engine::general_purpose::STANDARD.encode([0x89u8, 0x50, 0x4E, 0x47]);
        // A screenshot attached to the final user message must appear exactly
        // once and must not be duplicated onto earlier turns.
        let messages = vec![
            user("first", None),
            ChatMessage {
                role: "assistant".to_string(),
                content: "reply".to_string(),
                images: None,
            },
            user("second", Some(vec![png.clone()])),
        ];
        let out = to_anthropic_messages(&messages);
        let first = serde_json::to_value(&out[0]).unwrap();
        assert_eq!(
            first["content"]["type"], "text",
            "first turn must be text-only, got {first}"
        );
        let last = serde_json::to_value(&out[2]).unwrap();
        let parts = last["content"].as_array().expect("parts");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["type"], "image");
    }

    #[test]
    fn thinking_request_enables_extended_thinking() {
        let request = AnthropicRequest {
            model: "claude-sonnet-4-5".to_string(),
            max_tokens: THINKING_MAX_TOKENS,
            messages: vec![],
            tools: vec![],
            thinking: true.then(|| AnthropicThinking {
                r#type: "enabled".to_string(),
                budget_tokens: THINKING_BUDGET_TOKENS,
            }),
            stream: true,
        };
        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(json["thinking"]["type"], "enabled");
        assert_eq!(json["thinking"]["budget_tokens"], THINKING_BUDGET_TOKENS);
        assert!(json["max_tokens"].as_u64().unwrap() > THINKING_BUDGET_TOKENS as u64);
    }

    #[test]
    fn non_thinking_request_omits_thinking() {
        let request = AnthropicRequest {
            model: "claude-sonnet-4-5".to_string(),
            max_tokens: DEFAULT_MAX_TOKENS,
            messages: vec![],
            tools: vec![],
            thinking: None,
            stream: true,
        };
        let json = serde_json::to_value(&request).unwrap();
        assert!(json.get("thinking").is_none());
    }

    #[test]
    fn stream_delta_deserializes_thinking() {
        let json =
            r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}"#;
        let event: AnthropicStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.delta.unwrap().thinking.as_deref(), Some("hmm"));
    }

    #[test]
    fn drain_tool_call_clears_accumulator() {
        let mut id = "id1".to_string();
        let mut name = "computer".to_string();
        let mut args = "{}".to_string();
        let call = drain_tool_call(&mut id, &mut name, &mut args);
        assert_eq!(call.id, "id1");
        assert_eq!(call.name, "computer");
        assert_eq!(call.arguments, "{}");
        assert!(id.is_empty() && name.is_empty() && args.is_empty());
    }

    #[tokio::test]
    async fn missing_api_key_emits_error_without_network() {
        let client = reqwest::Client::new();
        let token = CancellationToken::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let err = stream_anthropic_chat(
            "http://127.0.0.1:1",
            "claude-sonnet-4-5",
            "",
            "sys",
            vec![user("hi", None)],
            false,
            false,
            1920,
            1080,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, super::super::CODE_MISSING_API_KEY);
        assert!(chunks.iter().any(
            |c| matches!(c, ProviderChunk::Error(e) if e.code == super::super::CODE_MISSING_API_KEY)
        ));
    }

    #[tokio::test]
    async fn http_429_maps_to_rate_limited() {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/v1/messages")
            .with_status(429)
            .with_body("slow down")
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let token = CancellationToken::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let err = stream_anthropic_chat(
            &server.url(),
            "claude-sonnet-4-5",
            "sk-ant",
            "sys",
            vec![user("hi", None)],
            false,
            false,
            1920,
            1080,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, super::super::CODE_RATE_LIMITED);
        assert!(
            matches!(&chunks[0], ProviderChunk::Error(e) if e.code == super::super::CODE_RATE_LIMITED)
        );
    }

    #[tokio::test]
    async fn streams_thinking_and_tokens() {
        let mut server = mockito::Server::new_async().await;
        let body = "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"plan\"}}\n\n\
                    data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n\
                    data: {\"type\":\"message_stop\"}\n\n";
        let _m = server
            .mock("POST", "/v1/messages")
            .with_body(body)
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let token = CancellationToken::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_anthropic_chat(
            &server.url(),
            "claude-sonnet-4-5",
            "sk-ant",
            "sys",
            vec![user("hi", None)],
            false,
            true,
            1920,
            1080,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        assert_eq!(accumulated, "Hi");
        assert!(matches!(&chunks[0], ProviderChunk::ThinkingToken(t) if t == "plan"));
        assert!(matches!(&chunks[1], ProviderChunk::Token(t) if t == "Hi"));
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    /// Runs the Anthropic stream against a mock server returning `body`.
    async fn run_against_body(
        body: &str,
        token: CancellationToken,
    ) -> (String, Vec<ProviderChunk>) {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/v1/messages")
            .with_body(body)
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_anthropic_chat(
            &server.url(),
            "claude-sonnet-4-5",
            "sk-ant",
            "sys",
            vec![user("hi", None)],
            false,
            false,
            1920,
            1080,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        (accumulated, chunks)
    }

    #[tokio::test]
    async fn tool_use_block_emits_tool_calls() {
        let body = "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"id1\",\"name\":\"computer\"}}\n\n\
                    data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"action\\\":\"}}\n\n\
                    data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"screenshot\\\"}\"}}\n\n\
                    data: {\"type\":\"content_block_stop\"}\n\n";
        let (_, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(chunks.iter().any(|c| matches!(
            c,
            ProviderChunk::ToolCalls(calls)
                if calls[0].id == "id1"
                    && calls[0].name == "computer"
                    && calls[0].arguments == "{\"action\":\"screenshot\"}"
        )));
    }

    #[tokio::test]
    async fn done_marker_flushes_pending_tool_call() {
        let body = "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"id1\",\"name\":\"computer\"}}\n\n\
                    data: [DONE]\n\n";
        let (_, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::ToolCalls(calls) if calls[0].name == "computer")));
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn stream_without_stop_event_completes_on_eof() {
        // Body ends without `message_stop`: the `None` arm must still emit Done.
        let body = "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert_eq!(accumulated, "hi");
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn unknown_events_are_ignored() {
        let body = ": comment line\n\
                    data: {\"type\":\"ping\"}\n\n\
                    data: not json\n\
                    data: {\"type\":\"message_stop\"}\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(accumulated.is_empty());
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn pre_cancelled_token_emits_cancelled() {
        let token = CancellationToken::new();
        token.cancel();
        let body = "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"x\"}}\n\n";
        let (_, chunks) = run_against_body(body, token).await;
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Cancelled)));
        assert!(!chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn mid_stream_transport_error_emits_error() {
        use tokio::io::AsyncWriteExt;
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let _ = stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ntest",
                )
                .await;
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let err = stream_anthropic_chat(
            &format!("http://127.0.0.1:{port}"),
            "claude-sonnet-4-5",
            "sk-ant",
            "sys",
            vec![user("hi", None)],
            false,
            false,
            1920,
            1080,
            &client,
            CancellationToken::new(),
            |c| chunks.push(c),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, super::super::CODE_NETWORK);
        assert!(chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::Error(e) if e.code == super::super::CODE_NETWORK)));
    }

    /// Serves `chunks` as a raw HTTP/1.1 chunked body, flushing each element
    /// separately so the client observes them as distinct network reads.
    async fn serve_chunks(chunks: Vec<Vec<u8>>) -> u16 {
        use tokio::io::AsyncWriteExt;
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let _ = stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
                )
                .await;
            for chunk in chunks {
                let _ = stream
                    .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                    .await;
                let _ = stream.write_all(&chunk).await;
                let _ = stream.write_all(b"\r\n").await;
                let _ = stream.flush().await;
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            let _ = stream.write_all(b"0\r\n\r\n").await;
        });
        port
    }

    async fn run_against_chunks(chunks: Vec<Vec<u8>>) -> (String, Vec<ProviderChunk>) {
        let port = serve_chunks(chunks).await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut out: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_anthropic_chat(
            &format!("http://127.0.0.1:{port}"),
            "claude-sonnet-4-5",
            "sk-ant",
            "sys",
            vec![user("hi", None)],
            false,
            false,
            1920,
            1080,
            &client,
            CancellationToken::new(),
            |c| out.push(c),
        )
        .await
        .unwrap();
        (accumulated, out)
    }

    #[tokio::test]
    async fn json_line_split_across_chunks_is_reassembled() {
        let full = b"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n";
        let mid = full.len() / 2;
        let (accumulated, _) = run_against_chunks(vec![
            full[..mid].to_vec(),
            full[mid..].to_vec(),
            b"data: {\"type\":\"message_stop\"}\n\n".to_vec(),
        ])
        .await;
        assert_eq!(accumulated, "hi");
    }

    #[tokio::test]
    async fn multibyte_char_split_across_chunks_is_not_corrupted() {
        let full = "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}\n\n"
            .as_bytes()
            .to_vec();
        let pos = full.windows(3).position(|w| w == "你".as_bytes()).unwrap();
        let split = pos + 1;
        let (accumulated, _) = run_against_chunks(vec![
            full[..split].to_vec(),
            full[split..].to_vec(),
            b"data: {\"type\":\"message_stop\"}\n\n".to_vec(),
        ])
        .await;
        assert_eq!(accumulated, "你好");
    }

    /// Runs the stream against a mock server with explicit `include_tools` and
    /// system-prompt values.
    async fn run_with_flags(
        body: &str,
        include_tools: bool,
        system_prompt: &str,
    ) -> (String, Vec<ProviderChunk>) {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/v1/messages")
            .with_body(body)
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_anthropic_chat(
            &server.url(),
            "claude-sonnet-4-5",
            "sk-ant",
            system_prompt,
            vec![user("hi", None)],
            include_tools,
            false,
            1920,
            1080,
            &client,
            CancellationToken::new(),
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        (accumulated, chunks)
    }

    #[tokio::test]
    async fn include_tools_serializes_computer_tool() {
        // The computer-use tool must reach the request body when tools are
        // enabled (the agent path).
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/messages")
            .match_body(mockito::Matcher::Regex("computer_20250124".to_string()))
            .with_body("data: {\"type\":\"message_stop\"}\n\n")
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        stream_anthropic_chat(
            &server.url(),
            "claude-sonnet-4-5",
            "sk-ant",
            "sys",
            vec![user("hi", None)],
            true,
            false,
            1920,
            1080,
            &client,
            CancellationToken::new(),
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn request_transport_failure_emits_network_error() {
        let client = reqwest::Client::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let err = stream_anthropic_chat(
            "foo://unsupported-scheme",
            "claude-sonnet-4-5",
            "sk-ant",
            "sys",
            vec![user("hi", None)],
            false,
            false,
            1920,
            1080,
            &client,
            CancellationToken::new(),
            |c| chunks.push(c),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, super::super::CODE_NETWORK);
        assert!(
            matches!(&chunks[0], ProviderChunk::Error(e) if e.code == super::super::CODE_NETWORK)
        );
    }

    #[tokio::test]
    async fn empty_system_prompt_still_streams() {
        // An empty system prompt must not inject a `system` field.
        let (accumulated, chunks) =
            run_with_flags("data: {\"type\":\"message_stop\"}\n\n", false, "").await;
        assert!(accumulated.is_empty());
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn content_block_start_variants_are_ignored() {
        // A non-tool_use start block, and a start event with no block at all,
        // must both be ignored.
        let body =
            "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"text\"}}\n\n\
                    data: {\"type\":\"content_block_start\"}\n\n\
                    data: {\"type\":\"message_stop\"}\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(accumulated.is_empty());
        assert!(!chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::ToolCalls(_))));
    }

    #[tokio::test]
    async fn content_block_delta_without_delta_is_ignored() {
        let body = "data: {\"type\":\"content_block_delta\"}\n\n\
                    data: {\"type\":\"message_stop\"}\n\n";
        let (accumulated, _) = run_against_body(body, CancellationToken::new()).await;
        assert!(accumulated.is_empty());
    }

    #[tokio::test]
    async fn empty_thinking_and_text_deltas_are_ignored() {
        let body = "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"\"}}\n\n\
                    data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"\"}}\n\n\
                    data: {\"type\":\"message_stop\"}\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(accumulated.is_empty());
        assert!(!chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::Token(_) | ProviderChunk::ThinkingToken(_))));
    }

    #[tokio::test]
    async fn content_block_stop_without_tool_use_emits_nothing() {
        let body = "data: {\"type\":\"content_block_stop\"}\n\n\
                    data: {\"type\":\"message_stop\"}\n\n";
        let (_, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(!chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::ToolCalls(_))));
    }

    #[tokio::test]
    async fn done_marker_without_pending_tool_call_emits_done_only() {
        let (_, chunks) = run_against_body("data: [DONE]\n\n", CancellationToken::new()).await;
        assert!(chunks.iter().all(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn http_statuses_map_to_their_error_codes() {
        for (status, code) in [
            (403usize, super::super::CODE_FORBIDDEN),
            (404, super::super::CODE_MODEL_NOT_FOUND),
            (500, super::super::CODE_SERVER_ERROR),
        ] {
            let mut server = mockito::Server::new_async().await;
            let _m = server
                .mock("POST", "/v1/messages")
                .with_status(status)
                .with_body("boom")
                .create_async()
                .await;
            let client = reqwest::Client::new();
            let err = stream_anthropic_chat(
                &server.url(),
                "claude-sonnet-4-5",
                "sk-ant",
                "sys",
                vec![user("hi", None)],
                false,
                false,
                1920,
                1080,
                &client,
                CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap_err();
            assert_eq!(err.code, code, "status {status}");
        }
    }
}
