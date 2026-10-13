//! OpenAI (and OpenAI-compatible) provider for streaming chat completions
//! with vision input, reasoning, and tool use.
//!
//! Implements the OpenAI Chat Completions API with SSE streaming, function
//! calling (tool use), image (`image_url` data-URI) input, and converts
//! responses to the unified [`ProviderChunk`] format. The same code path
//! serves the user-supplied "OpenAI-compatible" provider because the wire
//! format is identical; only the base URL differs.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::{
    classify_http_status, classify_transport_error, to_data_uri, ApiError, ProviderChunk, ToolCall,
};

/// Reasoning effort sent when `/think` is enabled for OpenAI reasoning models.
const REASONING_EFFORT: &str = "medium";

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct OpenAIChatRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OpenAITool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
    stream: bool,
}

#[derive(Serialize, Clone)]
struct OpenAIMessage {
    role: String,
    content: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAIToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct OpenAIToolCall {
    id: String,
    r#type: String,
    function: OpenAIFunctionCall,
}

#[derive(Serialize, Clone)]
struct OpenAIFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Serialize)]
pub struct OpenAITool {
    r#type: String,
    function: OpenAIFunction,
}

#[derive(Serialize)]
pub struct OpenAIFunction {
    name: String,
    description: String,
    parameters: Value,
}

// ─── SSE streaming types ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OpenAIStreamChunk {
    choices: Vec<OpenAIStreamChoice>,
}

#[derive(Deserialize)]
struct OpenAIStreamChoice {
    delta: OpenAIStreamDelta,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIStreamDelta {
    content: Option<String>,
    /// Reasoning tokens emitted by OpenAI-compatible reasoning models
    /// (e.g. DeepSeek's `reasoning_content`).
    reasoning_content: Option<String>,
    tool_calls: Option<Vec<OpenAIStreamToolCall>>,
}

#[derive(Deserialize)]
struct OpenAIStreamToolCall {
    index: Option<u32>,
    id: Option<String>,
    #[allow(dead_code)]
    r#type: Option<String>,
    function: Option<OpenAIStreamFunction>,
}

#[derive(Deserialize)]
struct OpenAIStreamFunction {
    name: Option<String>,
    arguments: Option<String>,
}

// ─── Computer use tool definitions ────────────────────────────────────────────

/// Returns the OpenAI-format tool definitions for computer control.
pub fn openai_computer_tools() -> Vec<OpenAITool> {
    vec![
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_click".to_string(),
                description: "Left-click at the specified screen coordinates.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "x": { "type": "integer", "description": "X coordinate in pixels" },
                        "y": { "type": "integer", "description": "Y coordinate in pixels" },
                    },
                    "required": ["x", "y"],
                }),
            },
        },
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_double_click".to_string(),
                description: "Double-click at the specified screen coordinates.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "x": { "type": "integer", "description": "X coordinate" },
                        "y": { "type": "integer", "description": "Y coordinate" },
                    },
                    "required": ["x", "y"],
                }),
            },
        },
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_right_click".to_string(),
                description: "Right-click at the specified screen coordinates.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "x": { "type": "integer" },
                        "y": { "type": "integer" },
                    },
                    "required": ["x", "y"],
                }),
            },
        },
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_type".to_string(),
                description: "Type text character by character.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "text": { "type": "string", "description": "The text to type" },
                    },
                    "required": ["text"],
                }),
            },
        },
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_key_press".to_string(),
                description: "Press a key combination (e.g., ctrl+c, alt+tab).".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "modifiers": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Modifier keys: ctrl, alt, shift",
                        },
                        "key": { "type": "string", "description": "The key to press" },
                    },
                    "required": ["key"],
                }),
            },
        },
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_scroll".to_string(),
                description: "Scroll the screen up or down.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "direction": { "type": "string", "enum": ["up", "down"] },
                        "amount": { "type": "integer", "description": "Number of scroll units (default 3)" },
                    },
                    "required": ["direction"],
                }),
            },
        },
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_launch".to_string(),
                description: "Open a program, file, or URL.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "target": { "type": "string", "description": "Program name, file path, or URL to open" },
                    },
                    "required": ["target"],
                }),
            },
        },
        OpenAITool {
            r#type: "function".to_string(),
            function: OpenAIFunction {
                name: "computer_screenshot".to_string(),
                description: "Take a screenshot to check the current screen state.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {},
                }),
            },
        },
    ]
}

// ─── Message translation ────────────────────────────────────────────────────────

/// Translates one internal [`ChatMessage`](crate::commands::ChatMessage) into
/// the OpenAI wire format. When the message carries images the content becomes
/// a parts array (text + `image_url` data-URIs); otherwise it stays a plain
/// string.
fn to_openai_message(m: crate::commands::ChatMessage) -> OpenAIMessage {
    let content = match m.images {
        Some(ref imgs) if !imgs.is_empty() => {
            let mut parts = vec![serde_json::json!({
                "type": "text",
                "text": m.content,
            })];
            for img in imgs {
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": { "url": to_data_uri(img) },
                }));
            }
            Value::Array(parts)
        }
        _ => Value::String(m.content),
    };
    OpenAIMessage {
        role: m.role,
        content,
        tool_calls: None,
        tool_call_id: None,
    }
}

// ─── Streaming chat ────────────────────────────────────────────────────────────

/// Streams a chat completion from an OpenAI-compatible endpoint.
///
/// Sends the conversation with optional tool definitions and optional
/// reasoning, streams the response, and emits [`ProviderChunk`] variants via
/// the `on_chunk` callback. If the model makes tool calls, they are collected
/// and emitted as a single `ProviderChunk::ToolCalls` chunk.
///
/// `think` enables reasoning output: the request carries `reasoning_effort` and
/// any `reasoning_content` streamed back is surfaced as
/// `ProviderChunk::ThinkingToken`.
///
/// An empty `api_key` is sent as-is: the OpenAI-compatible provider may point
/// at a local endpoint that needs no key. Callers that require a key (the
/// hosted OpenAI provider) enforce it before calling this function.
#[allow(clippy::too_many_arguments)]
pub async fn stream_openai_chat(
    base_url: &str,
    model: &str,
    api_key: &str,
    messages: Vec<crate::commands::ChatMessage>,
    include_tools: bool,
    think: bool,
    client: &reqwest::Client,
    cancel_token: CancellationToken,
    mut on_chunk: impl FnMut(ProviderChunk),
) -> Result<String, ApiError> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let openai_messages: Vec<OpenAIMessage> = messages.into_iter().map(to_openai_message).collect();

    let tools = if include_tools {
        openai_computer_tools()
    } else {
        vec![]
    };

    let request = OpenAIChatRequest {
        model: model.to_string(),
        messages: openai_messages,
        tools,
        reasoning_effort: think.then(|| REASONING_EFFORT.to_string()),
        stream: true,
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&request)
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
    let mut tool_calls_in_progress: Vec<OpenAIToolCall> = Vec::new();
    // Raw byte buffer carried across network chunks. SSE frames are newline
    // delimited, and a single `data: {…}` line (or even one UTF-8 codepoint)
    // can be split across chunks, so we only decode complete lines. Because
    // `0x0A` never appears inside a UTF-8 multibyte sequence, every complete
    // line is guaranteed to end on a codepoint boundary.
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
                                if !tool_calls_in_progress.is_empty() {
                                    on_chunk(ProviderChunk::ToolCalls(convert_tool_calls(
                                        &mut tool_calls_in_progress,
                                    )));
                                }
                                on_chunk(ProviderChunk::Done);
                                return Ok(accumulated);
                            }

                            if let Ok(chunk) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                                for choice in &chunk.choices {
                                    if let Some(ref reasoning) = choice.delta.reasoning_content {
                                        if !reasoning.is_empty() {
                                            on_chunk(ProviderChunk::ThinkingToken(reasoning.clone()));
                                        }
                                    }
                                    if let Some(ref content) = choice.delta.content {
                                        if !content.is_empty() {
                                            accumulated.push_str(content);
                                            on_chunk(ProviderChunk::Token(content.clone()));
                                        }
                                    }

                                    if let Some(ref calls) = choice.delta.tool_calls {
                                        accumulate_tool_calls(&mut tool_calls_in_progress, calls);
                                    }

                                    if let Some(ref reason) = choice.finish_reason {
                                        if (reason == "tool_calls" || reason == "stop")
                                            && !tool_calls_in_progress.is_empty()
                                        {
                                            on_chunk(ProviderChunk::ToolCalls(convert_tool_calls(
                                                &mut tool_calls_in_progress,
                                            )));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let err = classify_transport_error(&e);
                        on_chunk(ProviderChunk::Error(err.clone()));
                        return Err(err);
                    }
                    None => {
                        if !tool_calls_in_progress.is_empty() {
                            on_chunk(ProviderChunk::ToolCalls(convert_tool_calls(
                                &mut tool_calls_in_progress,
                            )));
                        }
                        on_chunk(ProviderChunk::Done);
                        return Ok(accumulated);
                    }
                }
            }
        }
    }
}

/// Drains the in-progress accumulator into the public [`ToolCall`] shape.
fn convert_tool_calls(in_progress: &mut Vec<OpenAIToolCall>) -> Vec<ToolCall> {
    std::mem::take(in_progress)
        .into_iter()
        .map(|tc| ToolCall {
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
        })
        .collect()
}

/// Merges one streamed tool-call delta into the accumulator, extending the
/// vector by index as OpenAI streams arguments incrementally.
fn accumulate_tool_calls(in_progress: &mut Vec<OpenAIToolCall>, calls: &[OpenAIStreamToolCall]) {
    for call in calls {
        let idx = call.index.unwrap_or(0) as usize;
        while in_progress.len() <= idx {
            in_progress.push(OpenAIToolCall {
                id: String::new(),
                r#type: "function".to_string(),
                function: OpenAIFunctionCall {
                    name: String::new(),
                    arguments: String::new(),
                },
            });
        }
        let tc = &mut in_progress[idx];
        if let Some(ref id) = call.id {
            tc.id = id.clone();
        }
        if let Some(ref func) = call.function {
            if let Some(ref name) = func.name {
                tc.function.name = name.clone();
            }
            if let Some(ref args) = func.arguments {
                tc.function.arguments.push_str(args);
            }
        }
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
    fn openai_tool_definitions_count() {
        let tools = openai_computer_tools();
        assert_eq!(tools.len(), 8); // click, double_click, right_click, type, key_press, scroll, launch, screenshot
    }

    #[test]
    fn text_only_message_serializes_content_as_string() {
        let msg = to_openai_message(user("Hello", None));
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"role\":\"user\""));
        assert!(json.contains("\"content\":\"Hello\""));
    }

    #[test]
    fn message_with_images_serializes_content_as_parts() {
        use base64::Engine;
        let png = base64::engine::general_purpose::STANDARD.encode([0x89u8, 0x50, 0x4E, 0x47]);
        let msg = to_openai_message(user("look", Some(vec![png])));
        let json = serde_json::to_value(&msg).unwrap();
        let parts = json["content"].as_array().expect("parts array");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0]["type"], "text");
        assert_eq!(parts[1]["type"], "image_url");
        assert!(parts[1]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn message_with_empty_image_list_is_text_only() {
        // An empty image list must be treated exactly like no images at all.
        let msg = to_openai_message(user("plain", Some(vec![])));
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["content"], "plain");
    }

    #[test]
    fn request_omits_tools_and_reasoning_by_default() {
        let request = OpenAIChatRequest {
            model: "gpt-4o".to_string(),
            messages: vec![to_openai_message(user("Test", None))],
            tools: vec![],
            reasoning_effort: None,
            stream: true,
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"model\":\"gpt-4o\""));
        assert!(json.contains("\"stream\":true"));
        assert!(!json.contains("\"tools\""));
        assert!(!json.contains("reasoning_effort"));
    }

    #[test]
    fn request_includes_reasoning_effort_when_think() {
        let request = OpenAIChatRequest {
            model: "o4-mini".to_string(),
            messages: vec![],
            tools: vec![],
            reasoning_effort: true.then(|| REASONING_EFFORT.to_string()),
            stream: true,
        };
        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(json["reasoning_effort"], REASONING_EFFORT);
    }

    #[test]
    fn stream_delta_deserializes_reasoning_content() {
        let json = r#"{"choices":[{"delta":{"reasoning_content":"hmm"},"finish_reason":null}]}"#;
        let chunk: OpenAIStreamChunk = serde_json::from_str(json).unwrap();
        assert_eq!(
            chunk.choices[0].delta.reasoning_content.as_deref(),
            Some("hmm")
        );
    }

    #[test]
    fn accumulate_tool_calls_merges_incremental_arguments() {
        let mut acc: Vec<OpenAIToolCall> = Vec::new();
        accumulate_tool_calls(
            &mut acc,
            &[OpenAIStreamToolCall {
                index: Some(0),
                id: Some("id1".to_string()),
                r#type: None,
                function: Some(OpenAIStreamFunction {
                    name: Some("computer_click".to_string()),
                    arguments: Some("{\"x\":".to_string()),
                }),
            }],
        );
        accumulate_tool_calls(
            &mut acc,
            &[OpenAIStreamToolCall {
                index: Some(0),
                id: None,
                r#type: None,
                function: Some(OpenAIStreamFunction {
                    name: None,
                    arguments: Some("1}".to_string()),
                }),
            }],
        );
        let converted = convert_tool_calls(&mut acc);
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].id, "id1");
        assert_eq!(converted[0].name, "computer_click");
        assert_eq!(converted[0].arguments, "{\"x\":1}");
        assert!(acc.is_empty(), "convert drains the accumulator");
    }

    #[tokio::test]
    async fn empty_api_key_is_allowed_for_compatible_endpoints() {
        // The "openai-compatible" provider may not need a key (local servers),
        // so the OpenAI request path must not reject an empty key itself.
        let mut server = mockito::Server::new_async().await;
        let body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let _m = server
            .mock("POST", "/chat/completions")
            .with_body(body)
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let token = CancellationToken::new();
        let accumulated = stream_openai_chat(
            &server.url(),
            "local-model",
            "",
            vec![user("hi", None)],
            false,
            false,
            &client,
            token,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(accumulated, "ok");
    }

    #[tokio::test]
    async fn http_401_maps_to_unauthorized() {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/chat/completions")
            .with_status(401)
            .with_body("invalid key")
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let token = CancellationToken::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let err = stream_openai_chat(
            &server.url(),
            "gpt-4o",
            "sk-bad",
            vec![user("hi", None)],
            false,
            false,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, super::super::CODE_UNAUTHORIZED);
        assert!(
            matches!(&chunks[0], ProviderChunk::Error(e) if e.code == super::super::CODE_UNAUTHORIZED)
        );
    }

    #[tokio::test]
    async fn streams_tokens_and_done() {
        let mut server = mockito::Server::new_async().await;
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n\
                    data: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let _m = server
            .mock("POST", "/chat/completions")
            .with_body(body)
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let token = CancellationToken::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_openai_chat(
            &server.url(),
            "gpt-4o",
            "sk-test",
            vec![user("hi", None)],
            false,
            false,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        assert_eq!(accumulated, "Hello");
        assert!(matches!(&chunks[0], ProviderChunk::Token(t) if t == "Hel"));
        assert!(matches!(&chunks[1], ProviderChunk::Token(t) if t == "lo"));
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn emits_thinking_tokens_from_reasoning_content() {
        let mut server = mockito::Server::new_async().await;
        let body = "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"step\"},\"finish_reason\":null}]}\n\n\
                    data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let _m = server
            .mock("POST", "/chat/completions")
            .with_body(body)
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let token = CancellationToken::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_openai_chat(
            &server.url(),
            "gpt-4o",
            "sk-test",
            vec![user("hi", None)],
            false,
            true,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        assert_eq!(accumulated, "ok");
        assert!(matches!(&chunks[0], ProviderChunk::ThinkingToken(t) if t == "step"));
        assert!(matches!(&chunks[1], ProviderChunk::Token(t) if t == "ok"));
    }

    /// Runs the stream against a mock server returning `body` and returns the
    /// accumulated text plus the emitted chunks.
    async fn run_against_body(
        body: &str,
        token: CancellationToken,
    ) -> (String, Vec<ProviderChunk>) {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/chat/completions")
            .with_body(body)
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_openai_chat(
            &server.url(),
            "gpt-4o",
            "sk-test",
            vec![user("hi", None)],
            false,
            false,
            &client,
            token,
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        (accumulated, chunks)
    }

    #[tokio::test]
    async fn emits_tool_calls_on_finish_reason() {
        let body = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"id1\",\"function\":{\"name\":\"computer_click\",\"arguments\":\"{\\\"x\\\":1}\"}}]},\"finish_reason\":null}]}\n\n\
                    data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n";
        let (_, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::ToolCalls(calls) if calls.len() == 1 && calls[0].name == "computer_click")));
    }

    #[tokio::test]
    async fn emits_pending_tool_calls_on_done_marker() {
        let body = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"id1\",\"function\":{\"name\":\"computer_type\",\"arguments\":\"{}\"}}]},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let (_, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(chunks.iter().any(
            |c| matches!(c, ProviderChunk::ToolCalls(calls) if calls[0].name == "computer_type")
        ));
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn finish_stop_without_tool_calls_emits_done_only() {
        let body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"},\"finish_reason\":\"stop\"}]}\n\n\
                    data: [DONE]\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert_eq!(accumulated, "hi");
        assert!(!chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::ToolCalls(_))));
    }

    #[tokio::test]
    async fn stream_without_done_marker_completes_on_eof() {
        // Body ends without `[DONE]`: the `None` arm must still emit Done.
        let body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert_eq!(accumulated, "hi");
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn eof_with_pending_tool_calls_emits_tool_calls() {
        // Tool call streamed, then EOF with no `[DONE]`: the `None` arm must
        // flush the pending tool call.
        let body = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"id1\",\"function\":{\"name\":\"computer_click\",\"arguments\":\"{}\"}}]},\"finish_reason\":null}]}\n\n";
        let (_, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(chunks.iter().any(
            |c| matches!(c, ProviderChunk::ToolCalls(calls) if calls[0].name == "computer_click")
        ));
    }

    #[tokio::test]
    async fn pre_cancelled_token_emits_cancelled() {
        let token = CancellationToken::new();
        token.cancel();
        let body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"x\"},\"finish_reason\":null}]}\n\n";
        let (_, chunks) = run_against_body(body, token).await;
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Cancelled)));
        assert!(!chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn malformed_and_non_data_lines_are_ignored() {
        let body = ": keep-alive comment\n\
                    data: not json\n\
                    data: {\"choices\":[{\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert_eq!(accumulated, "hi");
        assert!(
            chunks
                .iter()
                .filter(|c| matches!(c, ProviderChunk::Token(_)))
                .count()
                == 1
        );
    }

    #[tokio::test]
    async fn mid_stream_transport_error_emits_error() {
        use tokio::io::AsyncWriteExt;
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            // Promise a chunked body, send a partial chunk, then hang up.
            let _ = stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ntest",
                )
                .await;
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let err = stream_openai_chat(
            &format!("http://127.0.0.1:{port}"),
            "gpt-4o",
            "sk-test",
            vec![user("hi", None)],
            false,
            false,
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
        let accumulated = stream_openai_chat(
            &format!("http://127.0.0.1:{port}"),
            "gpt-4o",
            "sk-test",
            vec![user("hi", None)],
            false,
            false,
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
        let full =
            b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n";
        let mid = full.len() / 2;
        let (accumulated, _) = run_against_chunks(vec![
            full[..mid].to_vec(),
            full[mid..].to_vec(),
            b"data: [DONE]\n\n".to_vec(),
        ])
        .await;
        assert_eq!(accumulated, "hi");
    }

    #[tokio::test]
    async fn multibyte_char_split_across_chunks_is_not_corrupted() {
        let full =
            "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"},\"finish_reason\":null}]}\n\n"
                .as_bytes()
                .to_vec();
        // Split inside the first 3-byte codepoint of 你.
        let pos = full.windows(3).position(|w| w == "你".as_bytes()).unwrap();
        let split = pos + 1;
        let (accumulated, _) = run_against_chunks(vec![
            full[..split].to_vec(),
            full[split..].to_vec(),
            b"data: [DONE]\n\n".to_vec(),
        ])
        .await;
        assert_eq!(accumulated, "你好");
    }

    #[tokio::test]
    async fn include_tools_serializes_computer_tool_definitions() {
        // The tool definitions must actually reach the request body when tools
        // are enabled (the agent path); mockito fails the assert if they do not.
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .match_body(mockito::Matcher::Regex("computer_click".to_string()))
            .with_body("data: [DONE]\n\n")
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let accumulated = stream_openai_chat(
            &server.url(),
            "gpt-4o",
            "sk-test",
            vec![user("hi", None)],
            true,
            false,
            &client,
            CancellationToken::new(),
            |c| chunks.push(c),
        )
        .await
        .unwrap();
        mock.assert_async().await;
        assert!(accumulated.is_empty());
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn request_transport_failure_emits_network_error() {
        // An unsupported scheme fails at `send()` (never reaching the SSE loop),
        // exercising the request-time error mapping.
        let client = reqwest::Client::new();
        let mut chunks: Vec<ProviderChunk> = Vec::new();
        let err = stream_openai_chat(
            "foo://unsupported-scheme",
            "gpt-4o",
            "sk-test",
            vec![user("hi", None)],
            false,
            false,
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
    async fn empty_delta_fields_are_ignored() {
        // Chunks with no content/reasoning/tool_calls/finish_reason, and chunks
        // whose text fields are empty, must emit nothing.
        let body = "data: {\"choices\":[{\"delta\":{},\"finish_reason\":null}]}\n\n\
                    data: {\"choices\":[{\"delta\":{\"content\":\"\",\"reasoning_content\":\"\"},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let (accumulated, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(accumulated.is_empty());
        assert!(!chunks
            .iter()
            .any(|c| matches!(c, ProviderChunk::Token(_) | ProviderChunk::ThinkingToken(_))));
        assert!(chunks.iter().any(|c| matches!(c, ProviderChunk::Done)));
    }

    #[tokio::test]
    async fn multiple_choices_in_one_chunk_emit_all_tokens() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"A\"},\"finish_reason\":null},{\"delta\":{\"content\":\"B\"},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let (accumulated, _) = run_against_body(body, CancellationToken::new()).await;
        assert_eq!(accumulated, "AB");
    }

    #[tokio::test]
    async fn tool_call_index_gap_fills_placeholder_entries() {
        // An index beyond the current length forces placeholder entries to be
        // pushed so the vector stays index-addressable.
        let body = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":2,\"id\":\"id3\",\"function\":{\"name\":\"computer_launch\",\"arguments\":\"{}\"}}]},\"finish_reason\":null}]}\n\n\
                    data: [DONE]\n\n";
        let (_, chunks) = run_against_body(body, CancellationToken::new()).await;
        assert!(chunks.iter().any(
            |c| matches!(c, ProviderChunk::ToolCalls(calls) if calls.len() == 3 && calls[2].name == "computer_launch")
        ));
    }

    #[tokio::test]
    async fn done_without_any_data_emits_done_only() {
        let (accumulated, chunks) =
            run_against_body("data: [DONE]\n\n", CancellationToken::new()).await;
        assert!(accumulated.is_empty());
        assert!(chunks.iter().all(|c| matches!(c, ProviderChunk::Done)));
    }

    #[test]
    fn accumulate_tool_calls_tolerates_missing_function_and_arguments() {
        let mut acc: Vec<OpenAIToolCall> = Vec::new();
        accumulate_tool_calls(
            &mut acc,
            &[OpenAIStreamToolCall {
                index: Some(0),
                id: Some("id1".to_string()),
                r#type: None,
                function: None,
            }],
        );
        accumulate_tool_calls(
            &mut acc,
            &[OpenAIStreamToolCall {
                index: Some(0),
                id: None,
                r#type: None,
                function: Some(OpenAIStreamFunction {
                    name: Some("computer_click".to_string()),
                    arguments: None,
                }),
            }],
        );
        assert_eq!(acc.len(), 1);
        assert_eq!(acc[0].id, "id1");
        assert_eq!(acc[0].function.name, "computer_click");
        assert!(acc[0].function.arguments.is_empty());
    }

    #[tokio::test]
    async fn http_statuses_map_to_their_error_codes() {
        for (status, code) in [
            (403usize, super::super::CODE_FORBIDDEN),
            (404, super::super::CODE_MODEL_NOT_FOUND),
            (429, super::super::CODE_RATE_LIMITED),
            (500, super::super::CODE_SERVER_ERROR),
        ] {
            let mut server = mockito::Server::new_async().await;
            let _m = server
                .mock("POST", "/chat/completions")
                .with_status(status)
                .with_body("boom")
                .create_async()
                .await;
            let client = reqwest::Client::new();
            let err = stream_openai_chat(
                &server.url(),
                "gpt-4o",
                "sk-test",
                vec![user("hi", None)],
                false,
                false,
                &client,
                CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap_err();
            assert_eq!(err.code, code, "status {status}");
        }
    }

    #[tokio::test]
    async fn base_url_with_trailing_slash_is_trimmed() {
        // The openai-compatible provider takes a user-supplied base URL, which
        // may carry a trailing slash.
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .with_body("data: [DONE]\n\n")
            .create_async()
            .await;
        let client = reqwest::Client::new();
        let base = format!("{}/", server.url());
        let accumulated = stream_openai_chat(
            &base,
            "local-model",
            "",
            vec![user("hi", None)],
            false,
            false,
            &client,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        mock.assert_async().await;
        assert!(accumulated.is_empty());
    }
}
