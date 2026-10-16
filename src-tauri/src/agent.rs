//! Agent mode orchestrator for autonomous desktop control.
//!
//! Cloud-only: the agent drives the desktop through native tool calling from
//! the OpenAI / Anthropic / OpenAI-compatible providers. The model returns
//! structured JSON tool calls that map directly to a computer action.
//!
//! Confirmation model: driven by the `[agent].permission` setting. `limited`
//! (default) auto-executes safe actions and requires explicit user approval for
//! dangerous ones; `full` never asks.
//!
//! The frontend-facing [`AgentEvent`] carries no English UI prose: it ships a
//! structured [`AgentAction`] the frontend localizes, and reuses the
//! [`crate::providers`] error codes for failures. The provider is resolved from
//! the `[chat]` or `[agent]` section per `[agent].mode` at start time.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::commands::ChatProviderConfig;
use crate::computer_control::{self, AgentAction as ComputerAction};
use crate::config::AgentPermission;
use crate::providers::{self, ApiError, ProviderChunk, ToolCall};

/// Frontend event carrying agent-loop progress.
const AGENT_EVENT: &str = "quickai://agent";

// ─── Wire types ─────────────────────────────────────────────────────────────────

/// A desktop action in its wire form, localized by the frontend.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentAction {
    Click { x: i32, y: i32 },
    DoubleClick { x: i32, y: i32 },
    RightClick { x: i32, y: i32 },
    Drag { x1: i32, y1: i32, x2: i32, y2: i32 },
    Type { text: String },
    KeyPress { combo: String },
    Scroll { direction: String, amount: i32 },
    Launch { app: String },
    Done,
}

/// An event emitted by the agent loop to the frontend.
///
/// Model-produced text (`reasoning`, `result`, `summary`) is shown verbatim;
/// everything else is structured so the frontend can localize it.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    Reasoning { text: String },
    ActionExecuted { action: AgentAction, result: String },
    ConfirmationRequired { action: AgentAction },
    Error { code: String, message: String },
    Done { summary: String },
}

// ─── Confirmation state ─────────────────────────────────────────────────────────

/// Modifier spellings that denote the Windows key across providers.
const WIN_MODIFIERS: &[&str] = &["win", "lwin", "rwin", "meta", "super", "cmd"];
/// Key spellings that are the Windows key itself.
const WIN_KEYS: &[&str] = &["win", "lwin", "rwin", "meta"];

/// Whether a synthetic key press can reach a system surface or terminate the
/// foreground application.
///
/// `limited` mode exists to keep the agent from taking actions the user would
/// not expect, and key presses are a full bypass of the `Launch` gate: `Win+R`
/// opens the Run dialog (arbitrary program execution), `Win`/`Ctrl+Esc` open the
/// Start menu, `Ctrl+Shift+Esc` opens Task Manager, and `Alt+F4` closes the
/// foreground window. Combos are matched case-insensitively because provider
/// tool calls spell them inconsistently (`Ctrl`/`ctrl`, `Esc`/`Escape`).
fn is_dangerous_key_press(modifiers: &[String], key: &str) -> bool {
    let has = |name: &str| modifiers.iter().any(|m| m.eq_ignore_ascii_case(name));
    let is = |name: &str| key.eq_ignore_ascii_case(name);

    // Any use of the Windows key reaches a system surface (Start, Run,
    // Settings, lock screen).
    if WIN_MODIFIERS.iter().any(|w| has(w)) || WIN_KEYS.iter().any(|w| is(w)) {
        return true;
    }
    // Ctrl+Shift+Esc opens Task Manager; Ctrl+Esc opens the Start menu.
    if (has("ctrl") || has("control")) && (is("esc") || is("escape")) {
        return true;
    }
    // Alt+F4 closes the foreground window.
    has("alt") && is("f4")
}

/// Whether `action` requires explicit user approval under `permission`.
///
/// `full` never asks. `limited` asks only for the actions classified dangerous
/// below; everything else (clicks, drags, scrolling, plain typing) auto-executes
/// so ordinary automation is not interrupted.
///
/// Dangerous = can start or terminate arbitrary software:
/// - `Launch` starts an arbitrary program, file, or URL.
/// - `KeyPress` can reach the same capability indirectly (see
///   [`is_dangerous_key_press`]).
fn requires_confirmation(action: &ComputerAction, permission: AgentPermission) -> bool {
    match permission {
        AgentPermission::Full => false,
        AgentPermission::Limited => match action {
            ComputerAction::Launch { .. } => true,
            ComputerAction::KeyPress { modifiers, key } => is_dangerous_key_press(modifiers, key),
            _ => false,
        },
    }
}

/// Tracks the pending confirmation, if any.
struct ConfirmationState {
    /// Pending confirmations: action_id -> computer action.
    pending: HashMap<String, ComputerAction>,
}

impl ConfirmationState {
    fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    /// Mark an action as confirmed, returning it for execution.
    fn confirm(&mut self, action_id: &str) -> Option<ComputerAction> {
        self.pending.remove(action_id)
    }

    /// Reject an action.
    fn reject(&mut self, action_id: &str) -> Option<ComputerAction> {
        self.pending.remove(action_id)
    }

    /// Register a pending confirmation.
    fn add_pending(&mut self, action_id: String, action: ComputerAction) {
        self.pending.insert(action_id, action);
    }
}

// ─── Agent state ────────────────────────────────────────────────────────────────

/// Shared state for the running agent.
pub struct AgentState {
    cancel: Mutex<CancellationToken>,
    history: Mutex<Vec<String>>,
    confirmation: Mutex<ConfirmationState>,
    /// Channel to signal the agent loop when the user confirms/rejects.
    confirmation_tx: Mutex<Option<tokio::sync::oneshot::Sender<bool>>>,
    /// The action_id currently awaiting confirmation.
    pending_action_id: Mutex<Option<String>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            cancel: Mutex::new(CancellationToken::new()),
            history: Mutex::new(Vec::new()),
            confirmation: Mutex::new(ConfirmationState::new()),
            confirmation_tx: Mutex::new(None),
            pending_action_id: Mutex::new(None),
        }
    }

    fn add_to_history(&self, entry: String) {
        self.history.lock().unwrap().push(entry);
    }

    pub fn cancel(&self) {
        self.cancel.lock().unwrap().cancel();
    }

    fn is_cancelled(&self) -> bool {
        self.cancel.lock().unwrap().is_cancelled()
    }

    fn reset(&self) {
        *self.cancel.lock().unwrap() = CancellationToken::new();
        self.history.lock().unwrap().clear();
        *self.confirmation.lock().unwrap() = ConfirmationState::new();
        *self.confirmation_tx.lock().unwrap() = None;
        *self.pending_action_id.lock().unwrap() = None;
    }
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tool call → computer action conversion ─────────────────────────────────────

/// Converts a provider ToolCall to a computer action.
fn tool_call_to_action(tc: &ToolCall) -> Option<ComputerAction> {
    let args: serde_json::Value = serde_json::from_str(&tc.arguments).ok()?;
    match tc.name.as_str() {
        "computer_click" => {
            let x = args.get("x")?.as_i64()?;
            let y = args.get("y")?.as_i64()?;
            Some(ComputerAction::Click {
                x: x as i32,
                y: y as i32,
            })
        }
        "computer_double_click" => {
            let x = args.get("x")?.as_i64()?;
            let y = args.get("y")?.as_i64()?;
            Some(ComputerAction::DoubleClick {
                x: x as i32,
                y: y as i32,
            })
        }
        "computer_right_click" => {
            let x = args.get("x")?.as_i64()?;
            let y = args.get("y")?.as_i64()?;
            Some(ComputerAction::RightClick {
                x: x as i32,
                y: y as i32,
            })
        }
        "computer_type" => {
            let text = args.get("text")?.as_str()?.to_string();
            Some(ComputerAction::TypeText { text })
        }
        "computer_key_press" => {
            let key = args.get("key")?.as_str()?.to_string();
            let modifiers = args
                .get("modifiers")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Some(ComputerAction::KeyPress { modifiers, key })
        }
        "computer_scroll" => {
            let direction = args.get("direction")?.as_str()?.to_string();
            let amount = args.get("amount").and_then(|a| a.as_i64()).unwrap_or(3) as i32;
            Some(ComputerAction::Scroll { direction, amount })
        }
        "computer_launch" => {
            let target = args.get("target")?.as_str()?.to_string();
            Some(ComputerAction::Launch { target })
        }
        "computer_screenshot" => Some(ComputerAction::Screenshot {}),
        // Anthropic computer_use tool uses a single "computer" name with an "action" field.
        "computer" => {
            let action_type = args.get("action")?.as_str()?;
            match action_type {
                "left_click" | "click" => {
                    let (x, y) = coordinate(&args)?;
                    Some(ComputerAction::Click { x, y })
                }
                "double_click" => {
                    let (x, y) = coordinate(&args)?;
                    Some(ComputerAction::DoubleClick { x, y })
                }
                "right_click" => {
                    let (x, y) = coordinate(&args)?;
                    Some(ComputerAction::RightClick { x, y })
                }
                "type" => {
                    let text = args.get("text")?.as_str()?.to_string();
                    Some(ComputerAction::TypeText { text })
                }
                "key_press" | "key" => {
                    let key = args.get("key")?.as_str()?.to_string();
                    let modifiers = args
                        .get("modifiers")
                        .and_then(|m| m.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(ComputerAction::KeyPress { modifiers, key })
                }
                "scroll" => {
                    let direction = args.get("direction")?.as_str()?.to_string();
                    let amount = args.get("amount").and_then(|a| a.as_i64()).unwrap_or(3) as i32;
                    Some(ComputerAction::Scroll { direction, amount })
                }
                "screenshot" => Some(ComputerAction::Screenshot {}),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Reads an `[x, y]` coordinate pair from Anthropic computer-use arguments.
fn coordinate(args: &serde_json::Value) -> Option<(i32, i32)> {
    let arr = args.get("coordinate")?.as_array()?;
    if arr.len() >= 2 {
        Some((arr[0].as_i64()? as i32, arr[1].as_i64()? as i32))
    } else {
        None
    }
}

/// Maps an executable computer action to the wire [`AgentAction`] the frontend
/// localizes. Returns `None` for `Screenshot`, which is a control-flow action
/// (it just restarts the loop with a fresh capture) and is never surfaced.
fn to_event_action(action: &ComputerAction) -> Option<AgentAction> {
    Some(match action {
        ComputerAction::Click { x, y } => AgentAction::Click { x: *x, y: *y },
        ComputerAction::DoubleClick { x, y } => AgentAction::DoubleClick { x: *x, y: *y },
        ComputerAction::RightClick { x, y } => AgentAction::RightClick { x: *x, y: *y },
        ComputerAction::Drag {
            start_x,
            start_y,
            end_x,
            end_y,
            ..
        } => AgentAction::Drag {
            x1: *start_x,
            y1: *start_y,
            x2: *end_x,
            y2: *end_y,
        },
        ComputerAction::TypeText { text } => AgentAction::Type { text: text.clone() },
        ComputerAction::KeyPress { modifiers, key } => AgentAction::KeyPress {
            combo: combo(modifiers, key),
        },
        ComputerAction::Scroll { direction, amount } => AgentAction::Scroll {
            direction: direction.clone(),
            amount: *amount,
        },
        ComputerAction::Launch { target } => AgentAction::Launch {
            app: target.clone(),
        },
        ComputerAction::Done { .. } => AgentAction::Done,
        ComputerAction::Screenshot {} => return None,
    })
}

/// Joins modifiers and a key into a single combo string (e.g. `ctrl+shift+s`).
fn combo(modifiers: &[String], key: &str) -> String {
    if modifiers.is_empty() {
        key.to_string()
    } else {
        format!("{}+{}", modifiers.join("+"), key)
    }
}

// ─── System prompt ──────────────────────────────────────────────────────────────

/// System prompt for the tool-calling agent loop. Providers receive this as the
/// leading system message; the tool definitions themselves carry the exact
/// argument schema.
const AGENT_SYSTEM_PROMPT: &str = r#"You are a desktop automation agent controlling a Windows computer. On each turn you receive a screenshot of the current screen and must call the tools needed to make progress on the user's task.

Rules:
1. Respond by calling the available tools (computer_click, computer_double_click, computer_right_click, computer_type, computer_key_press, computer_scroll, computer_launch, computer_screenshot). Do not describe actions in prose when a tool call can perform them.
2. Coordinates are absolute screen pixels. Examine the screenshot carefully before clicking.
3. Call computer_screenshot when you need to verify a change before continuing.
4. Use computer_launch to open a program, file, or URL.
5. When the task is complete, reply with a short summary and no tool calls."#;

// ─── Iteration limits ───────────────────────────────────────────────────────────

const MAX_ITERATIONS: u32 = 30;
const ACTION_DELAY_MS: u64 = 500;
const SCREENSHOT_DELAY_MS: u64 = 500;

// ─── Agent loop ──────────────────────────────────────────────────────────────────

/// Emits an [`AgentEvent`] to the frontend, ignoring delivery errors.
fn emit(app_handle: &tauri::AppHandle, event: AgentEvent) {
    let _ = app_handle.emit(AGENT_EVENT, event);
}

/// Runs the agent loop with provider-based tool use.
pub async fn run_agent_loop(
    app_handle: tauri::AppHandle,
    state: Arc<AgentState>,
    task: String,
    config: ChatProviderConfig,
    permission: AgentPermission,
) -> Result<(), String> {
    state.reset();

    run_tool_use_loop(app_handle, state, task, config, permission).await
}

/// Agent loop using cloud provider tool calling (OpenAI / Anthropic /
/// OpenAI-compatible).
async fn run_tool_use_loop(
    app_handle: tauri::AppHandle,
    state: Arc<AgentState>,
    task: String,
    config: ChatProviderConfig,
    permission: AgentPermission,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let cancel_token = state.cancel.lock().unwrap().clone();

    // Build initial conversation.
    let mut messages: Vec<crate::commands::ChatMessage> = vec![
        crate::commands::ChatMessage {
            role: "system".to_string(),
            content: AGENT_SYSTEM_PROMPT.to_string(),
            images: None,
        },
        crate::commands::ChatMessage {
            role: "user".to_string(),
            content: format!("Task: {}", task),
            images: None,
        },
    ];

    for iteration in 0..MAX_ITERATIONS {
        if state.is_cancelled() {
            return Ok(());
        }

        eprintln!(
            "quickai: [agent] iteration {}/{}",
            iteration + 1,
            MAX_ITERATIONS
        );

        // Step 1: Take a screenshot.
        let screenshot_path = match capture_screenshot(&app_handle).await {
            Ok(p) => p,
            Err(e) => {
                eprintln!("quickai: [agent] screenshot failed: {e}");
                emit(
                    &app_handle,
                    AgentEvent::Error {
                        code: providers::CODE_UNKNOWN.to_string(),
                        message: format!("Screenshot failed: {e}"),
                    },
                );
                return Err(e);
            }
        };

        let screenshot_b64 = tokio::task::spawn_blocking({
            let path = screenshot_path.clone();
            move || read_image_as_base64(&path)
        })
        .await
        .map_err(|e| format!("Failed to read screenshot: {e}"))??;

        // Attach the screenshot to the final user message only, so a multi-turn
        // run sends one image per turn rather than one per message.
        let last_msg = messages.last_mut().expect("messages non-empty");
        if last_msg.role == "user" {
            last_msg
                .images
                .get_or_insert_with(Vec::new)
                .push(screenshot_b64);
        }

        // Step 2: Send to provider with tool definitions.
        let mut accumulated_text = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();

        let mut on_chunk = |chunk: ProviderChunk| match chunk {
            ProviderChunk::Token(t) => accumulated_text.push_str(&t),
            ProviderChunk::ToolCalls(calls) => tool_calls.extend(calls),
            ProviderChunk::Done
            | ProviderChunk::Cancelled
            | ProviderChunk::Error(_)
            | ProviderChunk::ThinkingToken(_) => {}
        };

        let result = match config.provider {
            providers::Provider::Anthropic => {
                providers::anthropic::stream_anthropic_chat(
                    &config.base_url,
                    &config.model,
                    &config.api_key,
                    AGENT_SYSTEM_PROMPT,
                    messages.clone(),
                    true,
                    false,
                    1920,
                    1080,
                    &client,
                    cancel_token.clone(),
                    &mut on_chunk,
                )
                .await
            }
            providers::Provider::OpenAi | providers::Provider::OpenAiCompatible => {
                providers::openai::stream_openai_chat(
                    &config.base_url,
                    &config.model,
                    &config.api_key,
                    messages.clone(),
                    true,
                    false,
                    &client,
                    cancel_token.clone(),
                    &mut on_chunk,
                )
                .await
            }
        };

        match result {
            Ok(text) => {
                if !text.is_empty() {
                    state.add_to_history(format!("[Model] {}", text));
                    emit(&app_handle, AgentEvent::Reasoning { text });
                }
            }
            Err(e) => {
                eprintln!("quickai: [agent] provider error: {}", e.message);
                emit(&app_handle, error_event(&e));
                return Err(e.message);
            }
        }

        // Step 3: If no tool calls, model is done talking.
        if tool_calls.is_empty() {
            let summary = accumulated_text.trim().to_string();
            emit(&app_handle, AgentEvent::Done { summary });
            return Ok(());
        }

        // Step 4: Convert and execute tool calls.
        for tc in &tool_calls {
            if state.is_cancelled() {
                return Ok(());
            }

            let action = match tool_call_to_action(tc) {
                Some(a) => a,
                None => {
                    eprintln!(
                        "quickai: [agent] unparseable tool call: {} {}",
                        tc.name, tc.arguments
                    );
                    continue;
                }
            };

            // `Screenshot` restarts the loop with a fresh capture; it is never
            // surfaced as an event.
            let Some(event_action) = to_event_action(&action) else {
                break;
            };

            // `Done` is the terminal event, not an executed action.
            if let ComputerAction::Done { summary } = &action {
                emit(
                    &app_handle,
                    AgentEvent::Done {
                        summary: summary.clone(),
                    },
                );
                return Ok(());
            }

            // Check if confirmation is needed.
            let needs_confirm = requires_confirmation(&action, permission);

            if needs_confirm {
                let action_id = uuid::Uuid::new_v4().to_string();

                {
                    let mut conf = state.confirmation.lock().unwrap();
                    conf.add_pending(action_id.clone(), action.clone());
                }

                // Create a oneshot channel for the frontend to signal confirmation.
                let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
                {
                    let mut sender = state.confirmation_tx.lock().unwrap();
                    *sender = Some(tx);
                }
                {
                    let mut pending = state.pending_action_id.lock().unwrap();
                    *pending = Some(action_id.clone());
                }

                emit(
                    &app_handle,
                    AgentEvent::ConfirmationRequired {
                        action: event_action,
                    },
                );

                // Wait for user confirmation with a 30-second timeout.
                match tokio::time::timeout(Duration::from_secs(30), rx).await {
                    Ok(Ok(true)) => {
                        // User confirmed the action.
                        let confirmed_action = {
                            let mut conf = state.confirmation.lock().unwrap();
                            conf.confirm(&action_id)
                        };
                        if let Some(confirmed_action) = confirmed_action {
                            let result = execute_action(&state, &confirmed_action).await?;
                            emit(
                                &app_handle,
                                AgentEvent::ActionExecuted {
                                    action: event_action_for(&confirmed_action),
                                    result,
                                },
                            );
                        }
                    }
                    _ => {
                        // User rejected or timed out — reject the action.
                        let mut conf = state.confirmation.lock().unwrap();
                        conf.reject(&action_id);
                        // Continue to next iteration without executing.
                    }
                }
            } else {
                let result = execute_action(&state, &action).await?;
                emit(
                    &app_handle,
                    AgentEvent::ActionExecuted {
                        action: event_action,
                        result,
                    },
                );
            }

            tokio::time::sleep(Duration::from_millis(ACTION_DELAY_MS)).await;
        }

        // Add assistant message with tool calls to conversation for next iteration.
        messages.push(crate::commands::ChatMessage {
            role: "assistant".to_string(),
            content: accumulated_text.clone(),
            images: None,
        });

        // Add tool result as user message for next iteration.
        messages.push(crate::commands::ChatMessage {
            role: "user".to_string(),
            content: "Action executed. Here is the updated screen.".to_string(),
            images: None,
        });

        tokio::time::sleep(Duration::from_millis(SCREENSHOT_DELAY_MS)).await;
    }

    let summary = "Agent reached maximum iteration limit".to_string();
    emit(&app_handle, AgentEvent::Done { summary });
    Ok(())
}

/// Builds an error event from a provider [`ApiError`].
fn error_event(err: &ApiError) -> AgentEvent {
    AgentEvent::Error {
        code: err.code.clone(),
        message: err.message.clone(),
    }
}

/// Converts a computer action to its wire form for an `ActionExecuted` event.
/// The action has already passed through `to_event_action`, so the fallback is
/// only a safety net.
fn event_action_for(action: &ComputerAction) -> AgentAction {
    to_event_action(action).unwrap_or(AgentAction::Done)
}

/// Executes a computer action and returns its result message.
async fn execute_action(state: &AgentState, action: &ComputerAction) -> Result<String, String> {
    let action_desc = format!("{:?}", action);
    let result = tokio::task::spawn_blocking({
        let action = action.clone();
        move || computer_control::execute_action(&action)
    })
    .await
    .map_err(|e| format!("Action execution panicked: {e}"))?;

    let result_msg = match result {
        Ok(()) => "ok".to_string(),
        Err(e) => e,
    };
    state.add_to_history(format!("[Action] {} -> {}", action_desc, result_msg));
    Ok(result_msg)
}

// ─── Screenshot capture ──────────────────────────────────────────────────────────

async fn capture_screenshot(app_handle: &tauri::AppHandle) -> Result<String, String> {
    crate::windows_screenshot::capture_silent_screenshot_command(app_handle.clone()).await
}

// ─── Image encoding ─────────────────────────────────────────────────────────────

fn read_image_as_base64(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read screenshot: {e}"))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &bytes,
    ))
}

// ─── Tauri commands ──────────────────────────────────────────────────────────────

/// Starts the cloud agent loop for `task`. The provider, model, base URL, and
/// API key come from the `[chat]` or `[agent]` section per `[agent].mode`; the
/// consent policy comes from `[agent].permission`.
///
/// `skills` are skill aliases (from `/do /add <alias> …`): their file contents
/// are appended to this run's task prompt. A missing or unreadable skill is
/// reported as an [`AgentEvent::Error`] and never fails the run.
#[tauri::command]
pub async fn start_agent_mode(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AgentState>>,
    task: String,
    skills: Option<Vec<String>>,
    config: tauri::State<'_, parking_lot::RwLock<crate::config::AppConfig>>,
    db: tauri::State<'_, crate::history::Database>,
) -> Result<(), String> {
    // Lock order (config read guard, then DB lock) matches `commands::ask`
    // and `history::generate_title`.
    let (provider_config, permission) = {
        let guard = config.read();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let provider_config =
            crate::commands::resolve_agent_provider(&guard, &conn).map_err(|e| e.message)?;
        (provider_config, guard.agent.permission)
    };

    // Skills are consulted only when this run names any: the agent never
    // injects enabled skills into its fixed tool-calling prompt, so an empty
    // selection makes the store irrelevant to this run and it is left unread.
    // Append the selected skills to the task prompt, mirroring the chat path;
    // a bad skill path must not fail the run, so it is reported as an agent
    // error event and the loop still starts.
    let selected = skills.unwrap_or_default();
    let task = if selected.is_empty() {
        task
    } else {
        let (skill_list, mut skill_failures) = crate::skills::load_for_turn(&app_handle).await;
        let (composed, selected_failures) =
            crate::skills::append_skills_by_alias(&task, &skill_list, &selected);
        skill_failures.extend(selected_failures);
        for failure in &skill_failures {
            emit(
                &app_handle,
                AgentEvent::Error {
                    code: crate::providers::CODE_SKILL_UNREADABLE.to_string(),
                    message: failure.detail(),
                },
            );
        }
        composed
    };

    let state = state.inner().clone();
    let app_handle = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_agent_loop(app_handle, state, task, provider_config, permission).await {
            eprintln!("quickai: [agent] error: {e}");
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_agent_mode(state: tauri::State<'_, Arc<AgentState>>) -> Result<(), String> {
    state.cancel();
    Ok(())
}

/// Confirm the pending agent action. `action_id` is optional: there is only
/// ever one pending confirmation, and the frontend is not required to echo an
/// id.
#[tauri::command]
pub fn confirm_agent_action(
    state: tauri::State<'_, Arc<AgentState>>,
    action_id: Option<String>,
) -> Result<String, String> {
    if let Some(id) = action_id {
        let pending_id = state.pending_action_id.lock().unwrap().clone();
        if pending_id.as_deref() != Some(id.as_str()) {
            return Err("No pending action with that ID".to_string());
        }
    }
    let sender = state.confirmation_tx.lock().unwrap().take();
    if let Some(tx) = sender {
        let _ = tx.send(true);
        Ok("Confirmed".to_string())
    } else {
        Err("No pending confirmation request".to_string())
    }
}

/// Reject the pending agent action. `action_id` is optional (see
/// [`confirm_agent_action`]).
#[tauri::command]
pub fn reject_agent_action(
    state: tauri::State<'_, Arc<AgentState>>,
    action_id: Option<String>,
) -> Result<String, String> {
    if let Some(id) = action_id {
        let pending_id = state.pending_action_id.lock().unwrap().clone();
        if pending_id.as_deref() != Some(id.as_str()) {
            return Err("No pending action with that ID".to_string());
        }
    }
    let sender = state.confirmation_tx.lock().unwrap().take();
    if let Some(tx) = sender {
        let _ = tx.send(false);
        Ok("Rejected".to_string())
    } else {
        Err("No pending confirmation request".to_string())
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_event_name_is_quickai_namespaced() {
        assert_eq!(AGENT_EVENT, "quickai://agent");
    }

    #[test]
    fn agent_event_serializes_with_kind_tag() {
        let json = serde_json::to_value(AgentEvent::Reasoning {
            text: "thinking".to_string(),
        })
        .unwrap();
        assert_eq!(json["kind"], "reasoning");
        assert_eq!(json["text"], "thinking");

        let json = serde_json::to_value(AgentEvent::Done {
            summary: "done".to_string(),
        })
        .unwrap();
        assert_eq!(json["kind"], "done");

        let json = serde_json::to_value(AgentEvent::Error {
            code: providers::CODE_MISSING_API_KEY.to_string(),
            message: "no key".to_string(),
        })
        .unwrap();
        assert_eq!(json["kind"], "error");
        assert_eq!(json["code"], providers::CODE_MISSING_API_KEY);
    }

    #[test]
    fn agent_event_carries_structured_action_not_prose() {
        let event = AgentEvent::ConfirmationRequired {
            action: AgentAction::Click { x: 100, y: 200 },
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["kind"], "confirmation_required");
        assert_eq!(json["action"]["type"], "click");
        assert_eq!(json["action"]["x"], 100);
        assert_eq!(json["action"]["y"], 200);

        let event = AgentEvent::ActionExecuted {
            action: AgentAction::Launch {
                app: "notepad".to_string(),
            },
            result: "ok".to_string(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["kind"], "action_executed");
        assert_eq!(json["action"]["type"], "launch");
        assert_eq!(json["action"]["app"], "notepad");
        assert_eq!(json["result"], "ok");
    }

    #[test]
    fn agent_action_serializes_every_variant() {
        let cases = vec![
            (AgentAction::Click { x: 1, y: 2 }, "click"),
            (AgentAction::DoubleClick { x: 1, y: 2 }, "double_click"),
            (AgentAction::RightClick { x: 1, y: 2 }, "right_click"),
            (
                AgentAction::Drag {
                    x1: 1,
                    y1: 2,
                    x2: 3,
                    y2: 4,
                },
                "drag",
            ),
            (
                AgentAction::Type {
                    text: "hi".to_string(),
                },
                "type",
            ),
            (
                AgentAction::KeyPress {
                    combo: "ctrl+c".to_string(),
                },
                "key_press",
            ),
            (
                AgentAction::Scroll {
                    direction: "down".to_string(),
                    amount: 3,
                },
                "scroll",
            ),
            (
                AgentAction::Launch {
                    app: "notepad".to_string(),
                },
                "launch",
            ),
            (AgentAction::Done, "done"),
        ];
        for (action, tag) in cases {
            let json = serde_json::to_value(&action).unwrap();
            assert_eq!(json["type"], tag);
        }
    }

    #[test]
    fn to_event_action_maps_every_executable_variant() {
        assert_eq!(
            to_event_action(&ComputerAction::Click { x: 1, y: 2 }),
            Some(AgentAction::Click { x: 1, y: 2 })
        );
        assert_eq!(
            to_event_action(&ComputerAction::DoubleClick { x: 1, y: 2 }),
            Some(AgentAction::DoubleClick { x: 1, y: 2 })
        );
        assert_eq!(
            to_event_action(&ComputerAction::RightClick { x: 1, y: 2 }),
            Some(AgentAction::RightClick { x: 1, y: 2 })
        );
        assert_eq!(
            to_event_action(&ComputerAction::Drag {
                start_x: 1,
                start_y: 2,
                end_x: 3,
                end_y: 4,
                duration_ms: 100,
            }),
            Some(AgentAction::Drag {
                x1: 1,
                y1: 2,
                x2: 3,
                y2: 4
            })
        );
        assert_eq!(
            to_event_action(&ComputerAction::TypeText {
                text: "hi".to_string()
            }),
            Some(AgentAction::Type {
                text: "hi".to_string()
            })
        );
        assert_eq!(
            to_event_action(&ComputerAction::KeyPress {
                modifiers: vec!["ctrl".to_string()],
                key: "c".to_string(),
            }),
            Some(AgentAction::KeyPress {
                combo: "ctrl+c".to_string()
            })
        );
        assert_eq!(
            to_event_action(&ComputerAction::Scroll {
                direction: "up".to_string(),
                amount: 5
            }),
            Some(AgentAction::Scroll {
                direction: "up".to_string(),
                amount: 5
            })
        );
        assert_eq!(
            to_event_action(&ComputerAction::Launch {
                target: "notepad".to_string()
            }),
            Some(AgentAction::Launch {
                app: "notepad".to_string()
            })
        );
        assert_eq!(
            to_event_action(&ComputerAction::Done {
                summary: "s".to_string()
            }),
            Some(AgentAction::Done)
        );
    }

    #[test]
    fn to_event_action_returns_none_for_screenshot() {
        assert_eq!(to_event_action(&ComputerAction::Screenshot {}), None);
    }

    #[test]
    fn combo_joins_modifiers() {
        assert_eq!(combo(&[], "enter"), "enter");
        assert_eq!(
            combo(&["ctrl".to_string(), "shift".to_string()], "s"),
            "ctrl+shift+s"
        );
    }

    #[test]
    fn error_event_reuses_api_error_code() {
        let err = ApiError::new(providers::CODE_RATE_LIMITED, "slow down");
        match error_event(&err) {
            AgentEvent::Error { code, message } => {
                assert_eq!(code, providers::CODE_RATE_LIMITED);
                assert_eq!(message, "slow down");
            }
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn agent_state_new_is_empty_and_not_cancelled() {
        let state = AgentState::new();
        assert!(!state.is_cancelled());
        assert!(state.history.lock().unwrap().is_empty());
    }

    #[test]
    fn agent_state_default_is_empty() {
        let state = AgentState::default();
        assert!(!state.is_cancelled());
    }

    #[test]
    fn agent_state_cancel() {
        let state = AgentState::new();
        assert!(!state.is_cancelled());
        state.cancel();
        assert!(state.is_cancelled());
    }

    #[test]
    fn agent_state_reset_clears_everything() {
        let state = AgentState::new();
        state.add_to_history("test".to_string());
        state.cancel();
        state.reset();
        assert!(!state.is_cancelled());
        assert!(state.history.lock().unwrap().is_empty());
    }

    #[test]
    fn agent_state_history() {
        let state = AgentState::new();
        state.add_to_history("entry1".to_string());
        state.add_to_history("entry2".to_string());
        let h = state.history.lock().unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0], "entry1");
        assert_eq!(h[1], "entry2");
    }

    #[test]
    fn iteration_and_delay_constants() {
        assert_eq!(MAX_ITERATIONS, 30);
        assert_eq!(ACTION_DELAY_MS, 500);
        assert_eq!(SCREENSHOT_DELAY_MS, 500);
    }

    #[test]
    fn system_prompt_describes_tools() {
        assert!(!AGENT_SYSTEM_PROMPT.is_empty());
        assert!(AGENT_SYSTEM_PROMPT.contains("computer_click"));
        assert!(AGENT_SYSTEM_PROMPT.contains("computer_screenshot"));
    }

    #[test]
    fn read_image_as_base64_file_not_found() {
        let result = read_image_as_base64("/nonexistent/path/to/image.png");
        assert!(result.is_err());
    }

    #[test]
    fn tool_call_to_action_click() {
        let tc = ToolCall {
            id: "1".to_string(),
            name: "computer_click".to_string(),
            arguments: r#"{"x": 100, "y": 200}"#.to_string(),
        };
        let action = tool_call_to_action(&tc).unwrap();
        assert!(matches!(action, ComputerAction::Click { x: 100, y: 200 }));
    }

    #[test]
    fn tool_call_to_action_type() {
        let tc = ToolCall {
            id: "2".to_string(),
            name: "computer_type".to_string(),
            arguments: r#"{"text": "Hello"}"#.to_string(),
        };
        let action = tool_call_to_action(&tc).unwrap();
        assert!(matches!(action, ComputerAction::TypeText { ref text } if text == "Hello"));
    }

    #[test]
    fn tool_call_to_action_key_press() {
        let tc = ToolCall {
            id: "3".to_string(),
            name: "computer_key_press".to_string(),
            arguments: r#"{"key": "c", "modifiers": ["ctrl"]}"#.to_string(),
        };
        let action = tool_call_to_action(&tc).unwrap();
        assert!(
            matches!(action, ComputerAction::KeyPress { ref modifiers, ref key } if modifiers.len() == 1 && key == "c")
        );
    }

    #[test]
    fn tool_call_to_action_scroll_and_screenshot_and_launch() {
        let tc = ToolCall {
            id: "s".to_string(),
            name: "computer_scroll".to_string(),
            arguments: r#"{"direction": "down"}"#.to_string(),
        };
        assert!(
            matches!(tool_call_to_action(&tc), Some(ComputerAction::Scroll { ref direction, amount }) if direction == "down" && amount == 3)
        );

        let tc = ToolCall {
            id: "s2".to_string(),
            name: "computer_screenshot".to_string(),
            arguments: "{}".to_string(),
        };
        assert!(matches!(
            tool_call_to_action(&tc),
            Some(ComputerAction::Screenshot {})
        ));

        let tc = ToolCall {
            id: "4".to_string(),
            name: "computer_launch".to_string(),
            arguments: r#"{"target": "notepad"}"#.to_string(),
        };
        assert!(
            matches!(tool_call_to_action(&tc), Some(ComputerAction::Launch { ref target }) if target == "notepad")
        );
    }

    #[test]
    fn tool_call_to_action_anthropic_click() {
        let tc = ToolCall {
            id: "5".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "left_click", "coordinate": [500, 300]}"#.to_string(),
        };
        let action = tool_call_to_action(&tc).unwrap();
        assert!(matches!(action, ComputerAction::Click { x: 500, y: 300 }));
    }

    #[test]
    fn tool_call_to_action_anthropic_variants() {
        let double = ToolCall {
            id: "d".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "double_click", "coordinate": [1, 2]}"#.to_string(),
        };
        assert!(matches!(
            tool_call_to_action(&double),
            Some(ComputerAction::DoubleClick { x: 1, y: 2 })
        ));

        let right = ToolCall {
            id: "r".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "right_click", "coordinate": [3, 4]}"#.to_string(),
        };
        assert!(matches!(
            tool_call_to_action(&right),
            Some(ComputerAction::RightClick { x: 3, y: 4 })
        ));

        let key = ToolCall {
            id: "k".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "key_press", "key": "enter"}"#.to_string(),
        };
        assert!(matches!(
            tool_call_to_action(&key),
            Some(ComputerAction::KeyPress { .. })
        ));

        let scroll = ToolCall {
            id: "sc".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "scroll", "direction": "up", "amount": 5}"#.to_string(),
        };
        assert!(
            matches!(tool_call_to_action(&scroll), Some(ComputerAction::Scroll { ref direction, amount }) if direction == "up" && amount == 5)
        );

        let shot = ToolCall {
            id: "sh".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "screenshot"}"#.to_string(),
        };
        assert!(matches!(
            tool_call_to_action(&shot),
            Some(ComputerAction::Screenshot {})
        ));

        let unknown = ToolCall {
            id: "u".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "teleport"}"#.to_string(),
        };
        assert!(tool_call_to_action(&unknown).is_none());
    }

    #[test]
    fn tool_call_to_action_malformed_coordinate_returns_none() {
        let tc = ToolCall {
            id: "bad".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "left_click", "coordinate": [5]}"#.to_string(),
        };
        assert!(tool_call_to_action(&tc).is_none());
    }

    #[test]
    fn tool_call_to_action_anthropic_type() {
        let tc = ToolCall {
            id: "6".to_string(),
            name: "computer".to_string(),
            arguments: r#"{"action": "type", "text": "Hello World"}"#.to_string(),
        };
        let action = tool_call_to_action(&tc).unwrap();
        assert!(matches!(action, ComputerAction::TypeText { ref text } if text == "Hello World"));
    }

    #[test]
    fn tool_call_to_action_unknown_returns_none() {
        let tc = ToolCall {
            id: "7".to_string(),
            name: "unknown_tool".to_string(),
            arguments: "{}".to_string(),
        };
        assert!(tool_call_to_action(&tc).is_none());
    }

    #[test]
    fn tool_call_to_action_bad_json_returns_none() {
        let tc = ToolCall {
            id: "8".to_string(),
            name: "computer_click".to_string(),
            arguments: "not json".to_string(),
        };
        assert!(tool_call_to_action(&tc).is_none());
    }

    #[test]
    fn limited_permission_auto_executes_safe_actions() {
        let click = ComputerAction::Click { x: 100, y: 200 };
        assert!(!requires_confirmation(&click, AgentPermission::Limited));
        let typed = ComputerAction::TypeText {
            text: "hi".to_string(),
        };
        assert!(!requires_confirmation(&typed, AgentPermission::Limited));
        let scroll = ComputerAction::Scroll {
            direction: "down".to_string(),
            amount: 3,
        };
        assert!(!requires_confirmation(&scroll, AgentPermission::Limited));
        // Ordinary editing shortcuts stay automatic.
        let copy = ComputerAction::KeyPress {
            modifiers: vec!["ctrl".to_string()],
            key: "c".to_string(),
        };
        assert!(!requires_confirmation(&copy, AgentPermission::Limited));
        let enter = ComputerAction::KeyPress {
            modifiers: vec![],
            key: "enter".to_string(),
        };
        assert!(!requires_confirmation(&enter, AgentPermission::Limited));
    }

    #[test]
    fn limited_permission_confirms_dangerous_actions() {
        let launch = ComputerAction::Launch {
            target: "notepad".to_string(),
        };
        assert!(requires_confirmation(&launch, AgentPermission::Limited));

        // Key presses that reach a system surface are equally dangerous — they
        // are a complete bypass of the `Launch` gate.
        for (modifiers, key) in [
            (vec!["win"], "r"),
            (vec!["meta"], "r"),
            (vec!["ctrl", "shift"], "esc"),
            (vec!["ctrl"], "escape"),
            (vec!["alt"], "f4"),
        ] {
            let action = ComputerAction::KeyPress {
                modifiers: modifiers.iter().map(|s| s.to_string()).collect(),
                key: key.to_string(),
            };
            assert!(
                requires_confirmation(&action, AgentPermission::Limited),
                "{modifiers:?}+{key} should require confirmation"
            );
        }
    }

    #[test]
    fn is_dangerous_key_press_rules() {
        let m = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        // Windows key, as a modifier or as the key itself.
        assert!(is_dangerous_key_press(&m(&["win"]), "d"));
        assert!(is_dangerous_key_press(&m(&["WIN"]), "r"));
        assert!(is_dangerous_key_press(&m(&[]), "lwin"));
        assert!(is_dangerous_key_press(&m(&["meta"]), "e"));
        // Task Manager / Start menu.
        assert!(is_dangerous_key_press(&m(&["ctrl", "shift"]), "Esc"));
        assert!(is_dangerous_key_press(&m(&["Control"]), "escape"));
        // Closing the foreground window.
        assert!(is_dangerous_key_press(&m(&["Alt"]), "F4"));

        // Benign combos stay safe.
        assert!(!is_dangerous_key_press(&m(&["ctrl"]), "c"));
        assert!(!is_dangerous_key_press(&m(&["ctrl", "shift"]), "s"));
        assert!(!is_dangerous_key_press(&m(&[]), "enter"));
        assert!(!is_dangerous_key_press(&m(&["alt"]), "tab"));
    }

    #[test]
    fn full_permission_never_confirms() {
        let launch = ComputerAction::Launch {
            target: "notepad".to_string(),
        };
        assert!(!requires_confirmation(&launch, AgentPermission::Full));
        let click = ComputerAction::Click { x: 1, y: 2 };
        assert!(!requires_confirmation(&click, AgentPermission::Full));
        let win_r = ComputerAction::KeyPress {
            modifiers: vec!["win".to_string()],
            key: "r".to_string(),
        };
        assert!(!requires_confirmation(&win_r, AgentPermission::Full));
    }

    #[test]
    fn confirmation_confirm_and_reject() {
        let mut cs = ConfirmationState::new();
        let action = ComputerAction::Click { x: 1, y: 2 };
        cs.add_pending("id1".to_string(), action.clone());

        let confirmed = cs.confirm("id1");
        assert!(confirmed.is_some());
        assert!(cs.confirm("id1").is_none()); // Already removed.

        cs.add_pending("id2".to_string(), action);
        let rejected = cs.reject("id2");
        assert!(rejected.is_some());
        assert!(cs.reject("id2").is_none()); // Already removed.
    }
}
