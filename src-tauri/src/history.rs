/*!
 * Tauri commands for conversation history persistence.
 *
 * All commands interact with the SQLite database through `database.rs`.
 * The database connection is stored behind a `Mutex` in Tauri's managed
 * state so that it is safely shared across command invocations.
 */

use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::{ChatMessage, ConversationHistory};
use crate::config::AppConfig;
use crate::database;

/// Thread-safe wrapper around the SQLite connection.
pub struct Database(pub Mutex<Connection>);

/// Message payload sent from the frontend when saving a conversation.
#[derive(Deserialize)]
pub struct SaveMessagePayload {
    pub role: String,
    pub content: String,
    pub quoted_text: Option<String>,
    pub image_paths: Option<Vec<String>>,
    pub thinking_content: Option<String>,
}

/// Response returned when saving a conversation.
#[derive(Serialize)]
pub struct SaveConversationResponse {
    pub conversation_id: String,
}

/// Longest placeholder title taken from the first user message. The guard is
/// byte length while the cut is char-counted, so a multi-byte message is never
/// split mid-codepoint.
const PLACEHOLDER_TITLE_MAX_CHARS: usize = 50;

/// Derives the placeholder title written when a conversation is first saved:
/// the first user message, trimmed and truncated to
/// [`PLACEHOLDER_TITLE_MAX_CHARS`]. Returns `None` when there is no user
/// message.
///
/// Shared by [`save_conversation`] (which writes it) and [`generate_title`]
/// (which uses it as the compare-and-set guard, so a generated title can never
/// clobber a manual rename).
fn placeholder_title(messages: &[SaveMessagePayload]) -> Option<String> {
    messages.iter().find(|m| m.role == "user").map(|m| {
        let trimmed = m.content.trim();
        if trimmed.len() > PLACEHOLDER_TITLE_MAX_CHARS {
            let end = trimmed
                .char_indices()
                .take(PLACEHOLDER_TITLE_MAX_CHARS)
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(PLACEHOLDER_TITLE_MAX_CHARS);
            format!("{}...", &trimmed[..end])
        } else {
            trimmed.to_string()
        }
    })
}

/// Persists the current in-memory conversation to SQLite. Creates a new
/// conversation row and bulk-inserts all messages. Returns the conversation ID
/// so the frontend can track it for subsequent auto-persist calls.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn save_conversation(
    messages: Vec<SaveMessagePayload>,
    model: String,
    db: State<'_, Database>,
) -> Result<SaveConversationResponse, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Use the first user message (truncated) as the initial title placeholder.
    let placeholder = placeholder_title(&messages);

    let conversation_id = database::create_conversation(&conn, placeholder.as_deref(), &model)
        .map_err(|e| e.to_string())?;

    let batch: Vec<database::MessageBatchRow> = messages
        .into_iter()
        .map(|m| {
            let image_json = m.image_paths.filter(|v| !v.is_empty()).map(|v| {
                serde_json::to_string(&v).expect("Vec<String> serialization is infallible")
            });
            (
                m.role,
                m.content,
                m.quoted_text,
                image_json,
                m.thinking_content,
            )
        })
        .collect();

    database::insert_messages_batch(&conn, &conversation_id, &batch).map_err(|e| e.to_string())?;

    Ok(SaveConversationResponse { conversation_id })
}

/// Appends a single message to an already-saved conversation.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn persist_message(
    conversation_id: String,
    role: String,
    content: String,
    quoted_text: Option<String>,
    image_paths: Option<Vec<String>>,
    thinking_content: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let image_json = image_paths
        .filter(|v| !v.is_empty())
        .map(|v| serde_json::to_string(&v).expect("Vec<String> serialization is infallible"));
    database::insert_message(
        &conn,
        &conversation_id,
        &role,
        &content,
        quoted_text.as_deref(),
        image_json.as_deref(),
        thinking_content.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Lists saved conversations, optionally filtered by a title search query.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn list_conversations(
    search: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<database::ConversationSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::list_conversations(&conn, search.as_deref()).map_err(|e| e.to_string())
}

/// Loads all messages for a conversation and syncs them into the backend
/// `ConversationHistory` so subsequent `ask` calls include context.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn load_conversation(
    conversation_id: String,
    db: State<'_, Database>,
    history: State<'_, ConversationHistory>,
) -> Result<Vec<database::PersistedMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let persisted = database::load_messages(&conn, &conversation_id).map_err(|e| e.to_string())?;

    // Bump the epoch before replacing messages — same invariant as
    // `reset_conversation`. This prevents any in-flight `ask`
    // stream from appending stale tokens into the freshly loaded history.
    history
        .epoch
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    let mut conv = history.messages.lock().map_err(|e| e.to_string())?;
    conv.clear();
    for msg in &persisted {
        conv.push(ChatMessage {
            role: msg.role.clone(),
            content: msg.content.clone(),
            images: None,
        });
    }

    Ok(persisted)
}

/// Deletes a conversation and all its messages from SQLite, and immediately
/// removes any image files referenced by those messages from disk.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn delete_conversation(
    conversation_id: String,
    data_dir: State<'_, crate::config::ResolvedDataDir>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Collect image paths before deleting messages (CASCADE will remove them).
    let messages = database::load_messages(&conn, &conversation_id).map_err(|e| e.to_string())?;
    let image_paths: Vec<String> = messages
        .iter()
        .filter_map(|m| m.image_paths.as_ref())
        .filter_map(|json| serde_json::from_str::<Vec<String>>(json).ok())
        .flatten()
        .collect();

    database::delete_conversation(&conn, &conversation_id).map_err(|e| e.to_string())?;

    // Best-effort file cleanup — don't fail the command if a file is missing.
    let base_dir = data_dir.path();
    for path in &image_paths {
        let _ = crate::images::remove_image(base_dir, path);
    }

    Ok(())
}

/// Longest conversation title accepted by [`rename_conversation`]. Longer
/// titles are capped rather than rejected so a long paste still saves
/// something usable.
const MAX_CONVERSATION_TITLE_CHARS: usize = 200;

/// Trims `title` and caps it at [`MAX_CONVERSATION_TITLE_CHARS`] characters
/// (counted by `char`, so multi-byte text is never split mid-codepoint).
/// Returns `None` when the trimmed title is empty.
///
/// Split out of the command so the validation rules are unit-tested; the
/// command itself is coverage-excluded like every other Tauri wrapper.
fn normalize_conversation_title(title: &str) -> Option<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_CONVERSATION_TITLE_CHARS).collect())
}

/// Renames a saved conversation.
///
/// The title is trimmed and capped; an empty title (after trimming) is
/// rejected with a plain string error, matching the other history commands.
/// An unknown `conversation_id` is not an error: the underlying UPDATE simply
/// matches no rows, the same idempotent semantics as
/// [`delete_conversation`].
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn rename_conversation(
    conversation_id: String,
    title: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let title = normalize_conversation_title(&title)
        .ok_or_else(|| "conversation title must not be empty".to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::update_conversation_title(&conn, &conversation_id, &title).map_err(|e| e.to_string())
}

/// Generates a short AI title for a saved conversation by asking the configured
/// chat provider. Runs as a fire-and-forget background task — the frontend
/// polls or refreshes the list to see the updated title.
///
/// The title is written with a compare-and-set guard: it replaces only the
/// placeholder title [`save_conversation`] wrote, so a manual rename that lands
/// while generation is in flight is never clobbered.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub async fn generate_title(
    conversation_id: String,
    messages: Vec<SaveMessagePayload>,
    db: State<'_, Database>,
    client: State<'_, reqwest::Client>,
    config: State<'_, parking_lot::RwLock<AppConfig>>,
) -> Result<(), String> {
    // Build a condensed context for title generation.
    let mut context = String::new();
    for msg in &messages {
        let prefix = if msg.role == "user" {
            "User"
        } else {
            "Assistant"
        };
        context.push_str(&format!("{}: {}\n", prefix, msg.content));
        if context.len() > 1000 {
            break;
        }
    }

    let title_prompt = format!(
        "Summarize this conversation in 5 words or fewer as a title. \
         Return ONLY the title, no quotes, no punctuation at the end, no explanation.\n\n{}",
        context
    );

    // Resolve the chat provider and system prompt, dropping both guards before
    // the await point. Lock order (config read guard, then DB lock) matches
    // `commands::ask` so the two paths cannot deadlock against each other.
    let (provider_cfg, system_prompt) = {
        let guard = config.read();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let cfg = crate::commands::resolve_chat_provider(&guard, &conn).map_err(|e| e.message)?;
        (cfg, guard.prompt.resolved_system.clone())
    };

    let title_messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt.clone(),
            images: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: title_prompt,
            images: None,
        },
    ];

    let cancel_token = tokio_util::sync::CancellationToken::new();
    let accumulated = crate::commands::stream_chat(
        &provider_cfg,
        &system_prompt,
        title_messages,
        false,
        &client,
        cancel_token,
        &mut |_| {}, // No per-chunk side effects; we use the accumulated return value.
    )
    .await;

    let mut title = accumulated.trim().to_string();

    // Truncate overly long titles.
    if title.len() > 100 {
        if let Some((i, c)) = title.char_indices().take(100).last() {
            title.truncate(i + c.len_utf8());
            title.push_str("...");
        }
    }

    if !title.is_empty() {
        // Compare-and-set against the placeholder `save_conversation` wrote. A
        // manual rename that lands while this fire-and-forget generation is in
        // flight makes the stored title differ, and the write is skipped so the
        // user's name survives. If generation lands first, a later rename still
        // wins (it is an unconditional write). Either order preserves the manual
        // title.
        let expected = placeholder_title(&messages);
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        database::update_conversation_title_if_unchanged(
            &conn,
            &conversation_id,
            expected.as_deref(),
            &title,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database;

    /// Helper to create a Database state from an in-memory connection.
    fn test_db() -> Database {
        Database(Mutex::new(database::open_in_memory().unwrap()))
    }

    #[test]
    fn save_and_load_conversation_roundtrip() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let messages = vec![
            SaveMessagePayload {
                role: "user".to_string(),
                content: "What is Rust?".to_string(),
                quoted_text: None,
                image_paths: Some(vec!["/tmp/img.jpg".to_string()]),
                thinking_content: None,
            },
            SaveMessagePayload {
                role: "assistant".to_string(),
                content: "Rust is a systems programming language.".to_string(),
                quoted_text: None,
                image_paths: None,
                thinking_content: Some("Let me think about Rust...".to_string()),
            },
        ];

        // Create conversation + insert messages.
        let placeholder_title = messages
            .iter()
            .find(|m| m.role == "user")
            .map(|m| m.content.trim().to_string());

        let conversation_id =
            database::create_conversation(&conn, placeholder_title.as_deref(), "gpt-4o").unwrap();

        let batch: Vec<database::MessageBatchRow> = messages
            .into_iter()
            .map(|m| {
                let image_json = m.image_paths.filter(|v| !v.is_empty()).map(|v| {
                    serde_json::to_string(&v).expect("Vec<String> serialization is infallible")
                });
                (
                    m.role,
                    m.content,
                    m.quoted_text,
                    image_json,
                    m.thinking_content,
                )
            })
            .collect();

        database::insert_messages_batch(&conn, &conversation_id, &batch).unwrap();

        // Load back.
        let loaded = database::load_messages(&conn, &conversation_id).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].role, "user");
        assert_eq!(loaded[0].content, "What is Rust?");
        assert_eq!(
            loaded[0].image_paths.as_deref(),
            Some(r#"["/tmp/img.jpg"]"#)
        );
        assert_eq!(loaded[0].thinking_content, None);
        assert_eq!(loaded[1].role, "assistant");
        assert!(loaded[1].image_paths.is_none());
        assert_eq!(
            loaded[1].thinking_content.as_deref(),
            Some("Let me think about Rust...")
        );
    }

    #[test]
    fn placeholder_title_truncation() {
        let long_message = "a".repeat(100);
        // Long message (100 chars) should be truncated to 50 + "..."
        assert!(long_message.len() > 50);
        let end = long_message
            .char_indices()
            .take(50)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(50);
        let title = format!("{}...", &long_message[..end]);
        assert_eq!(title.len(), 53); // 50 chars + "..."
        assert!(title.ends_with("..."));
    }

    #[test]
    fn placeholder_title_short_message() {
        let short = "Hello";
        // Short message (5 chars) should not be truncated.
        assert!(short.len() <= 50);
        assert_eq!(short, "Hello");
    }

    #[test]
    fn placeholder_title_with_unicode() {
        let unicode_msg = "こんにちは世界、これはテストメッセージです。長いテキストを作成するために追加のテキストが必要です。";
        let trimmed = unicode_msg.trim();
        // Unicode message with byte length > 50 should truncate at char boundary.
        assert!(trimmed.len() > 50);
        let end = trimmed
            .char_indices()
            .take(50)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(50);
        let title = format!("{}...", &trimmed[..end]);
        // Should not panic on unicode boundary.
        assert!(title.ends_with("..."));
    }

    #[test]
    fn title_truncation_over_100_chars() {
        let mut title = "a".repeat(150);
        // Titles over 100 chars should be truncated to 100 + "..."
        assert!(title.len() > 100);
        let (i, c) = title.char_indices().take(100).last().unwrap();
        title.truncate(i + c.len_utf8());
        title.push_str("...");
        assert_eq!(title.len(), 103); // 100 + "..."
    }

    #[test]
    fn normalize_conversation_title_trims_surrounding_whitespace() {
        assert_eq!(
            normalize_conversation_title("  Weekly plan \n").as_deref(),
            Some("Weekly plan")
        );
    }

    #[test]
    fn normalize_conversation_title_rejects_blank() {
        assert!(normalize_conversation_title("").is_none());
        assert!(normalize_conversation_title("   \t\n ").is_none());
    }

    #[test]
    fn normalize_conversation_title_caps_length_by_chars() {
        let long = "日".repeat(MAX_CONVERSATION_TITLE_CHARS + 50);
        let capped = normalize_conversation_title(&long).expect("non-empty");
        assert_eq!(capped.chars().count(), MAX_CONVERSATION_TITLE_CHARS);
    }

    #[test]
    fn rename_updates_the_stored_title() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let id = database::create_conversation(&conn, Some("Old name"), "gpt-4o").unwrap();

        let title = normalize_conversation_title("  New name  ").expect("non-empty");
        database::update_conversation_title(&conn, &id, &title).unwrap();

        let listed = database::list_conversations(&conn, None).unwrap();
        assert_eq!(listed[0].title.as_deref(), Some("New name"));
    }

    fn user_payload(content: &str) -> SaveMessagePayload {
        SaveMessagePayload {
            role: "user".to_string(),
            content: content.to_string(),
            quoted_text: None,
            image_paths: None,
            thinking_content: None,
        }
    }

    #[test]
    fn placeholder_title_is_none_without_a_user_message() {
        let assistant_only = vec![SaveMessagePayload {
            role: "assistant".to_string(),
            content: "hello".to_string(),
            quoted_text: None,
            image_paths: None,
            thinking_content: None,
        }];
        assert!(placeholder_title(&assistant_only).is_none());
    }

    #[test]
    fn placeholder_title_uses_the_first_user_message() {
        let messages = vec![
            user_payload("What is Rust?"),
            user_payload("A later question that must be ignored"),
        ];
        assert_eq!(
            placeholder_title(&messages).as_deref(),
            Some("What is Rust?")
        );
    }

    #[test]
    fn placeholder_title_truncates_long_messages_without_splitting_codepoints() {
        let long = "a".repeat(100);
        let expected = format!("{}...", "a".repeat(50));
        assert_eq!(
            placeholder_title(&[user_payload(&long)]).as_deref(),
            Some(expected.as_str())
        );

        // 40 multi-byte chars (120 bytes) fit entirely, so the cut lands at the
        // end rather than mid-codepoint.
        let unicode = "日".repeat(40);
        let expected = format!("{unicode}...");
        assert_eq!(
            placeholder_title(&[user_payload(&unicode)]).as_deref(),
            Some(expected.as_str())
        );
    }

    /// Item 12: a manual rename that lands while the fire-and-forget AI title is
    /// still in flight must survive in the database.
    #[test]
    fn generated_title_never_clobbers_a_manual_rename() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let messages = vec![user_payload("What is Rust?")];

        // `save_conversation` writes the placeholder title.
        let placeholder = placeholder_title(&messages);
        let id = database::create_conversation(&conn, placeholder.as_deref(), "gpt-4o").unwrap();

        // The user renames by hand before the generated title lands.
        database::update_conversation_title(&conn, &id, "My notes").unwrap();

        // The generated title then tries to replace the placeholder it expected.
        let wrote = database::update_conversation_title_if_unchanged(
            &conn,
            &id,
            placeholder.as_deref(),
            "Rust overview",
        )
        .unwrap();

        assert!(
            !wrote,
            "the compare-and-set must skip a renamed conversation"
        );
        let listed = database::list_conversations(&conn, None).unwrap();
        assert_eq!(listed[0].title.as_deref(), Some("My notes"));
    }

    /// The normal path is unchanged: an untouched conversation gets its AI name.
    #[test]
    fn generated_title_names_an_untouched_conversation() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let messages = vec![user_payload("What is Rust?")];
        let placeholder = placeholder_title(&messages);
        let id = database::create_conversation(&conn, placeholder.as_deref(), "gpt-4o").unwrap();

        let wrote = database::update_conversation_title_if_unchanged(
            &conn,
            &id,
            placeholder.as_deref(),
            "Rust overview",
        )
        .unwrap();

        assert!(wrote);
        let listed = database::list_conversations(&conn, None).unwrap();
        assert_eq!(listed[0].title.as_deref(), Some("Rust overview"));
    }
}
