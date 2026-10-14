//! Tests for `settings_commands`.
//!
//! Coverage strategy: every code path in `set_config_field`'s coercion +
//! patching pipeline is exercised against a temp-dir TOML file. The Tauri
//! command wrappers are coverage-excluded; their happy paths are exercised
//! indirectly through the testable internals (`patch_document`,
//! `coerce_json_to_toml`, `read_document`).

use std::path::PathBuf;

use serde_json::json;
use toml_edit::DocumentMut;

use super::{
    coerce_json_to_toml, is_allowed_field, is_allowed_section, json_type_name,
    json_value_to_toml_item, patch_document, read_document, reset_section_on_disk,
    write_field_to_disk,
};
use crate::config::defaults::{ALLOWED_FIELDS, ALLOWED_SECTIONS};
use crate::config::{AgentMode, AgentPermission, ConfigError, Hotkey, Language};

// ─── Test fixtures ──────────────────────────────────────────────────────────

const SAMPLE_CONFIG: &str = r#"# Top-level comment preserved across GUI patches.
[prompt]
# Custom persona note from the user
system = ""

[window]
overlay_width = 600.0
max_chat_height = 648.0
max_images = 3

[quote]
max_display_lines = 4
max_display_chars = 300
max_context_length = 4096

[general]
hotkey = "ctrl"
language = "auto"
data_dir = ""

[chat]
provider = "openai"
model = "gpt-4o"
base_url = ""

[agent]
mode = "same_as_chat"
provider = "openai"
model = ""
base_url = ""
permission = "limited"
"#;

fn parse_sample() -> DocumentMut {
    SAMPLE_CONFIG.parse().expect("sample config parses")
}

// ─── ALLOWED_FIELDS / ALLOWED_SECTIONS ──────────────────────────────────────

#[test]
fn allowed_fields_count_matches_schema_field_count() {
    // Hand-counted from `AppConfig`: prompt(1) + window(3) + quote(3)
    // + general(3) + chat(3) + agent(5) = 18 tunable fields. If this assertion
    // fails, the schema has drifted from the allowlist and someone added a
    // field without extending ALLOWED_FIELDS.
    assert_eq!(ALLOWED_FIELDS.len(), 18);
}

#[test]
fn allowed_sections_match_app_config_top_level_keys() {
    assert_eq!(
        ALLOWED_SECTIONS,
        &["prompt", "window", "quote", "general", "chat", "agent"]
    );
}

#[test]
fn is_allowed_field_accepts_known_pair() {
    assert!(is_allowed_field("chat", "provider"));
    assert!(is_allowed_field("chat", "model"));
    assert!(is_allowed_field("agent", "base_url"));
    assert!(is_allowed_field("agent", "mode"));
    assert!(is_allowed_field("agent", "permission"));
    assert!(is_allowed_field("general", "hotkey"));
    assert!(is_allowed_field("general", "language"));
    assert!(is_allowed_field("general", "data_dir"));
    assert!(is_allowed_field("window", "max_images"));
}

#[test]
fn is_allowed_field_rejects_unknown_pair() {
    assert!(!is_allowed_field("chat", "secret_api_key"));
    assert!(!is_allowed_field("window", "unknown_key"));
    assert!(!is_allowed_field("activation", "hotkey"));
}

#[test]
fn is_allowed_section_accepts_known() {
    for section in ALLOWED_SECTIONS {
        assert!(is_allowed_section(section));
    }
}

#[test]
fn is_allowed_section_rejects_unknown() {
    assert!(!is_allowed_section("legacy"));
    assert!(!is_allowed_section(""));
}

// ─── coerce_json_to_toml ────────────────────────────────────────────────────

#[test]
fn coerce_integer_accepts_json_integer() {
    let doc = parse_sample();
    let item = doc.get("window").unwrap().get("max_images").unwrap();
    let coerced = coerce_json_to_toml(item, json!(5), "window", "max_images").unwrap();
    assert_eq!(coerced.as_integer(), Some(5));
}

#[test]
fn coerce_integer_accepts_whole_float() {
    let doc = parse_sample();
    let item = doc.get("window").unwrap().get("max_images").unwrap();
    let coerced = coerce_json_to_toml(item, json!(5.0), "window", "max_images").unwrap();
    assert_eq!(coerced.as_integer(), Some(5));
}

#[test]
fn coerce_integer_rejects_fractional_float() {
    let doc = parse_sample();
    let item = doc.get("window").unwrap().get("max_images").unwrap();
    let err = coerce_json_to_toml(item, json!(5.5), "window", "max_images").unwrap_err();
    matches_type_mismatch(&err, "window", "max_images");
}

#[test]
fn coerce_integer_rejects_string() {
    let doc = parse_sample();
    let item = doc.get("window").unwrap().get("max_images").unwrap();
    let err = coerce_json_to_toml(item, json!("nope"), "window", "max_images").unwrap_err();
    matches_type_mismatch(&err, "window", "max_images");
}

#[test]
fn coerce_float_accepts_float_and_integer() {
    let doc = parse_sample();
    let item = doc.get("window").unwrap().get("overlay_width").unwrap();
    let from_float = coerce_json_to_toml(item, json!(720.5), "window", "overlay_width").unwrap();
    assert_eq!(from_float.as_float(), Some(720.5));

    let from_int = coerce_json_to_toml(item, json!(720), "window", "overlay_width").unwrap();
    assert_eq!(from_int.as_float(), Some(720.0));
}

#[test]
fn coerce_float_rejects_string() {
    let doc = parse_sample();
    let item = doc.get("window").unwrap().get("overlay_width").unwrap();
    let err = coerce_json_to_toml(item, json!("720"), "window", "overlay_width").unwrap_err();
    matches_type_mismatch(&err, "window", "overlay_width");
}

#[test]
fn coerce_string_accepts_json_string() {
    let doc = parse_sample();
    let item = doc.get("chat").unwrap().get("model").unwrap();
    let coerced = coerce_json_to_toml(item, json!("claude-sonnet-4-5"), "chat", "model").unwrap();
    assert_eq!(coerced.as_str(), Some("claude-sonnet-4-5"));
}

#[test]
fn coerce_string_rejects_integer() {
    let doc = parse_sample();
    let item = doc.get("chat").unwrap().get("model").unwrap();
    let err = coerce_json_to_toml(item, json!(42), "chat", "model").unwrap_err();
    matches_type_mismatch(&err, "chat", "model");
}

#[test]
fn coerce_array_accepts_string_array() {
    let doc: DocumentMut = "available = [\"gemma4:e2b\"]\n".parse().unwrap();
    let item = doc.get("available").unwrap();
    let coerced =
        coerce_json_to_toml(item, json!(["gpt-4o", "o4-mini"]), "section", "available").unwrap();
    let arr = coerced.as_array().expect("array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr.get(0).and_then(|v| v.as_str()), Some("gpt-4o"));
}

#[test]
fn coerce_array_rejects_non_string_element() {
    let doc: DocumentMut = "available = [\"a\"]\n".parse().unwrap();
    let item = doc.get("available").unwrap();
    let err = coerce_json_to_toml(item, json!(["a", 42]), "section", "available").unwrap_err();
    matches_type_mismatch(&err, "section", "available");
}

#[test]
fn coerce_array_rejects_non_array_value() {
    let doc: DocumentMut = "available = [\"a\"]\n".parse().unwrap();
    let item = doc.get("available").unwrap();
    let err = coerce_json_to_toml(item, json!("nope"), "section", "available").unwrap_err();
    matches_type_mismatch(&err, "section", "available");
}

#[test]
fn coerce_boolean_accepts_json_bool() {
    let doc: DocumentMut = "flag = true\n".parse().unwrap();
    let item = doc.get("flag").unwrap();
    let coerced = coerce_json_to_toml(item, json!(false), "section", "flag").unwrap();
    assert_eq!(coerced.as_bool(), Some(false));
}

#[test]
fn coerce_boolean_rejects_string() {
    let doc: DocumentMut = "flag = true\n".parse().unwrap();
    let item = doc.get("flag").unwrap();
    let err = coerce_json_to_toml(item, json!("true"), "section", "flag").unwrap_err();
    matches_type_mismatch(&err, "section", "flag");
}

#[test]
fn coerce_rejects_datetime_field() {
    let doc: DocumentMut = "stamp = 1979-05-27T07:32:00Z\n".parse().unwrap();
    let item = doc.get("stamp").unwrap();
    let err = coerce_json_to_toml(item, json!("nope"), "section", "stamp").unwrap_err();
    matches_type_mismatch(&err, "section", "stamp");
}

#[test]
fn coerce_rejects_inline_table_field() {
    let doc: DocumentMut = "obj = { a = 1 }\n".parse().unwrap();
    let item = doc.get("obj").unwrap();
    let err = coerce_json_to_toml(item, json!("nope"), "section", "obj").unwrap_err();
    matches_type_mismatch(&err, "section", "obj");
}

#[test]
fn coerce_rejects_when_existing_is_not_primitive() {
    // Construct an Item that is not a primitive value (e.g. a sub-table) to
    // exercise the early-return error branch.
    let mut doc = DocumentMut::new();
    doc.insert("section", toml_edit::Item::Table(toml_edit::Table::new()));
    let table_item = doc.get("section").unwrap();
    let err = coerce_json_to_toml(table_item, json!("v"), "section", "key").unwrap_err();
    matches_type_mismatch(&err, "section", "key");
}

// ─── patch_document ─────────────────────────────────────────────────────────

#[test]
fn patch_document_overwrites_existing_field() {
    let mut doc = parse_sample();
    patch_document(&mut doc, "chat", "model", json!("gpt-4.1")).unwrap();
    let new_model = doc
        .get("chat")
        .unwrap()
        .get("model")
        .unwrap()
        .as_str()
        .unwrap();
    assert_eq!(new_model, "gpt-4.1");
}

#[test]
fn patch_document_preserves_top_level_comment() {
    let mut doc = parse_sample();
    patch_document(&mut doc, "chat", "model", json!("gpt-4.1")).unwrap();
    let serialized = doc.to_string();
    assert!(
        serialized.contains("# Top-level comment preserved"),
        "comment was lost: {serialized}"
    );
    assert!(
        serialized.contains("# Custom persona note"),
        "section comment was lost: {serialized}"
    );
}

#[test]
fn patch_document_unknown_section_errors() {
    let mut doc = parse_sample();
    let err = patch_document(&mut doc, "activation", "hotkey", json!("ctrl+ctrl")).unwrap_err();
    match err {
        ConfigError::UnknownSection { section } => assert_eq!(section, "activation"),
        other => panic!("expected UnknownSection, got {other:?}"),
    }
}

#[test]
fn patch_document_inserts_missing_float_field() {
    // Simulate a hand-edited config where `overlay_width` was removed.
    let toml = "[window]\nmax_chat_height = 648.0\n";
    let mut doc: DocumentMut = toml.parse().unwrap();
    patch_document(&mut doc, "window", "overlay_width", json!(800.5)).unwrap();
    let inserted = doc
        .get("window")
        .unwrap()
        .get("overlay_width")
        .unwrap()
        .as_float()
        .expect("float");
    assert!((inserted - 800.5).abs() < f64::EPSILON);
}

#[test]
fn patch_document_inserts_missing_string_field() {
    let toml = "[chat]\nmodel = \"gpt-4o\"\n";
    let mut doc: DocumentMut = toml.parse().unwrap();
    patch_document(&mut doc, "chat", "base_url", json!("http://proxy/v1")).unwrap();
    let inserted = doc
        .get("chat")
        .unwrap()
        .get("base_url")
        .unwrap()
        .as_str()
        .expect("string");
    assert_eq!(inserted, "http://proxy/v1");
}

#[test]
fn patch_document_inserts_missing_integer_field() {
    let toml = "[quote]\nmax_display_chars = 300\n";
    let mut doc: DocumentMut = toml.parse().unwrap();
    patch_document(&mut doc, "quote", "max_display_lines", json!(6)).unwrap();
    let inserted = doc
        .get("quote")
        .unwrap()
        .get("max_display_lines")
        .unwrap()
        .as_integer()
        .expect("integer");
    assert_eq!(inserted, 6);
}

#[test]
fn patch_document_inserts_missing_array_field() {
    let toml = "[chat]\nmodel = \"gpt-4o\"\n";
    let mut doc: DocumentMut = toml.parse().unwrap();
    patch_document(&mut doc, "chat", "fallbacks", json!(["a", "b"])).unwrap();
    let arr = doc
        .get("chat")
        .unwrap()
        .get("fallbacks")
        .unwrap()
        .as_array()
        .expect("array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr.get(0).and_then(|v| v.as_str()), Some("a"));
}

#[test]
fn patch_document_insert_rejects_object_for_missing_field() {
    let toml = "[window]\nmax_chat_height = 648.0\n";
    let mut doc: DocumentMut = toml.parse().unwrap();
    let err = patch_document(&mut doc, "window", "overlay_width", json!({"a": 1})).unwrap_err();
    matches_type_mismatch(&err, "window", "overlay_width");
}

#[test]
fn patch_document_insert_rejects_array_with_non_string_for_missing_field() {
    let toml = "[chat]\nmodel = \"gpt-4o\"\n";
    let mut doc: DocumentMut = toml.parse().unwrap();
    let err = patch_document(&mut doc, "chat", "fallbacks", json!(["ok", 42])).unwrap_err();
    matches_type_mismatch(&err, "chat", "fallbacks");
}

// ─── json_value_to_toml_item ─────────────────────────────────────────────────

#[test]
fn json_value_to_toml_item_inserts_bool() {
    let item = json_value_to_toml_item(json!(true), "s", "k").unwrap();
    assert_eq!(item.as_bool(), Some(true));
}

// ─── read_document ──────────────────────────────────────────────────────────

#[test]
fn read_document_parses_existing_file() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();
    let doc = read_document(&path).unwrap();
    assert!(doc.get("chat").is_some());
}

#[test]
fn read_document_io_error_for_missing_file() {
    let dir = tempdir();
    let path = dir.join("missing.toml");
    let err = read_document(&path).unwrap_err();
    matches!(err, ConfigError::IoError { .. });
}

#[test]
fn read_document_parse_error_for_invalid_toml() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, "this is not = valid toml [oops\n").unwrap();
    let err = read_document(&path).unwrap_err();
    match err {
        ConfigError::Parse { path: p, .. } => assert_eq!(p, path),
        other => panic!("expected Parse, got {other:?}"),
    }
}

// ─── consume_corrupt_marker ─────────────────────────────────────────────────

#[test]
fn consume_corrupt_marker_returns_none_when_absent() {
    let dir = tempdir();
    assert!(crate::config::consume_corrupt_marker(&dir).is_none());
}

#[test]
fn consume_corrupt_marker_reads_and_deletes() {
    let dir = tempdir();
    let marker_path = dir.join(crate::config::CORRUPT_MARKER_FILE_NAME);
    std::fs::write(&marker_path, "/tmp/old-config.toml.corrupt-1234\n1234\n").unwrap();
    let marker = crate::config::consume_corrupt_marker(&dir).expect("marker present");
    assert_eq!(marker.path, "/tmp/old-config.toml.corrupt-1234");
    assert_eq!(marker.ts, 1234);
    assert!(
        !marker_path.exists(),
        "marker should be deleted after consume"
    );
}

#[test]
fn consume_corrupt_marker_rejects_malformed_payload() {
    let dir = tempdir();
    let marker_path = dir.join(crate::config::CORRUPT_MARKER_FILE_NAME);
    std::fs::write(&marker_path, "only-one-line\n").unwrap();
    assert!(crate::config::consume_corrupt_marker(&dir).is_none());
}

#[test]
fn consume_corrupt_marker_rejects_empty_path() {
    let dir = tempdir();
    let marker_path = dir.join(crate::config::CORRUPT_MARKER_FILE_NAME);
    std::fs::write(&marker_path, "\n1234\n").unwrap();
    assert!(crate::config::consume_corrupt_marker(&dir).is_none());
}

#[test]
fn consume_corrupt_marker_rejects_unparseable_ts() {
    let dir = tempdir();
    let marker_path = dir.join(crate::config::CORRUPT_MARKER_FILE_NAME);
    std::fs::write(&marker_path, "/tmp/x\nnot-a-number\n").unwrap();
    assert!(crate::config::consume_corrupt_marker(&dir).is_none());
}

// ─── json_type_name ─────────────────────────────────────────────────────────

#[test]
fn json_type_name_covers_every_variant() {
    assert_eq!(json_type_name(&json!(null)), "null");
    assert_eq!(json_type_name(&json!(true)), "boolean");
    assert_eq!(json_type_name(&json!(42)), "integer");
    assert_eq!(json_type_name(&json!(42u64)), "integer");
    assert_eq!(json_type_name(&json!(2.5_f64)), "float");
    assert_eq!(json_type_name(&json!("s")), "string");
    assert_eq!(json_type_name(&json!([1, 2])), "array");
    assert_eq!(json_type_name(&json!({"a": 1})), "object");
}

// ─── write_field_to_disk ────────────────────────────────────────────────────

#[test]
fn write_field_to_disk_persists_and_returns_resolved_config() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let resolved = write_field_to_disk(&path, "chat", "model", json!("gpt-4.1")).unwrap();
    assert_eq!(resolved.chat.model, "gpt-4.1");

    let on_disk = std::fs::read_to_string(&path).unwrap();
    assert!(on_disk.contains("gpt-4.1"));
}

#[test]
fn write_field_to_disk_accepts_window_max_images() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let resolved = write_field_to_disk(&path, "window", "max_images", json!(6)).unwrap();
    assert_eq!(resolved.window.max_images, 6);

    let on_disk = std::fs::read_to_string(&path).unwrap();
    assert!(on_disk.contains("max_images = 6"));
}

#[test]
fn write_field_to_disk_accepts_general_hotkey() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let resolved = write_field_to_disk(&path, "general", "hotkey", json!("alt")).unwrap();
    assert_eq!(resolved.general.hotkey, Hotkey::Alt);

    let on_disk = std::fs::read_to_string(&path).unwrap();
    assert!(on_disk.contains("hotkey = \"alt\""));
}

#[test]
fn write_field_to_disk_accepts_general_language_and_data_dir() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let resolved = write_field_to_disk(&path, "general", "language", json!("zh")).unwrap();
    assert_eq!(resolved.general.language, Language::Zh);

    let resolved = write_field_to_disk(&path, "general", "data_dir", json!("D:/quickai")).unwrap();
    assert_eq!(resolved.general.data_dir, "D:/quickai");
}

#[test]
fn write_field_to_disk_accepts_agent_mode_and_permission() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let resolved = write_field_to_disk(&path, "agent", "mode", json!("custom")).unwrap();
    assert_eq!(resolved.agent.mode, AgentMode::Custom);

    let resolved = write_field_to_disk(&path, "agent", "permission", json!("full")).unwrap();
    assert_eq!(resolved.agent.permission, AgentPermission::Full);
}

#[test]
fn write_field_to_disk_rejects_unknown_section() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();
    let err = write_field_to_disk(&path, "activation", "hotkey", json!("ctrl+ctrl")).unwrap_err();
    match err {
        ConfigError::UnknownSection { section } => assert_eq!(section, "activation"),
        other => panic!("expected UnknownSection, got {other:?}"),
    }
}

#[test]
fn write_field_to_disk_rejects_unknown_field() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();
    let err = write_field_to_disk(&path, "chat", "secret_api_key", json!("hunter2")).unwrap_err();
    match err {
        ConfigError::UnknownField { section, key } => {
            assert_eq!(section, "chat");
            assert_eq!(key, "secret_api_key");
        }
        other => panic!("expected UnknownField, got {other:?}"),
    }
}

#[test]
fn write_field_to_disk_propagates_read_error_for_missing_file() {
    let dir = tempdir();
    let path = dir.join("missing.toml");
    let err = write_field_to_disk(&path, "chat", "model", json!("gpt-4o")).unwrap_err();
    matches!(err, ConfigError::IoError { .. });
}

#[test]
fn write_field_to_disk_propagates_patch_error_for_type_mismatch() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();
    let err = write_field_to_disk(&path, "chat", "model", json!(42)).unwrap_err();
    matches_type_mismatch(&err, "chat", "model");
}

#[cfg(unix)]
#[test]
fn write_field_to_disk_propagates_io_error_when_parent_dir_is_readonly() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    // Read-only directory: atomic_write_bytes can read the existing file but
    // cannot create the temp file alongside it for the rename swap.
    let mut perms = std::fs::metadata(&dir).unwrap().permissions();
    perms.set_mode(0o500);
    std::fs::set_permissions(&dir, perms.clone()).unwrap();

    let err = write_field_to_disk(&path, "chat", "model", json!("gpt-4.1")).unwrap_err();

    // Restore writability so the OS can clean up the tempdir later.
    let mut restore = perms;
    restore.set_mode(0o700);
    std::fs::set_permissions(&dir, restore).unwrap();

    matches!(err, ConfigError::IoError { .. });
}

/// On Windows, renaming the atomic tmpfile over a read-only target fails, so
/// the write-error branch is exercised even though the read succeeded. This
/// keeps the write-error path covered on the Windows CI runner (the read-only
/// parent-directory trick above only fails on Unix).
#[cfg(windows)]
#[test]
// `set_readonly(false)` is meaningful on Windows; the lint guards against the
// misleading no-op on Unix.
#[allow(clippy::permissions_set_readonly_false)]
fn write_field_to_disk_propagates_io_error_when_target_is_readonly() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms).unwrap();

    let err = write_field_to_disk(&path, "chat", "model", json!("gpt-4.1")).unwrap_err();

    // Restore so the OS can clean up the tempdir later.
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(false);
    let _ = std::fs::set_permissions(&path, perms);

    matches!(err, ConfigError::IoError { .. });
}

// ─── reset_section_on_disk ──────────────────────────────────────────────────
#[test]
fn reset_section_on_disk_replaces_named_section_with_defaults() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    // Mutate the field first so reset has something to revert.
    write_field_to_disk(&path, "chat", "model", json!("gpt-4.1")).unwrap();

    let resolved = reset_section_on_disk(&path, Some("chat")).unwrap();
    // The default chat model is empty (item 1: no default model).
    assert!(resolved.chat.model.is_empty());
}

#[test]
fn reset_section_on_disk_preserves_other_sections() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    // Change two sections.
    write_field_to_disk(&path, "chat", "model", json!("gpt-4.1")).unwrap();
    write_field_to_disk(&path, "window", "max_images", json!(7)).unwrap();

    // Reset only chat; window.max_images should still be 7.
    let resolved = reset_section_on_disk(&path, Some("chat")).unwrap();
    assert_eq!(resolved.window.max_images, 7);
}

#[test]
fn reset_section_on_disk_resets_general_section() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    write_field_to_disk(&path, "general", "hotkey", json!("win")).unwrap();
    let resolved = reset_section_on_disk(&path, Some("general")).unwrap();
    assert_eq!(resolved.general.hotkey, Hotkey::Ctrl);
}

#[test]
fn reset_section_on_disk_whole_file_resets_everything() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    write_field_to_disk(&path, "window", "max_images", json!(7)).unwrap();
    let resolved = reset_section_on_disk(&path, None).unwrap();
    // Default is 3 per defaults.rs.
    assert_eq!(resolved.window.max_images, 3);
}

#[test]
fn reset_section_on_disk_rejects_unknown_section() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();
    let err = reset_section_on_disk(&path, Some("activation")).unwrap_err();
    match err {
        ConfigError::UnknownSection { section } => assert_eq!(section, "activation"),
        other => panic!("expected UnknownSection, got {other:?}"),
    }
}

#[test]
fn reset_section_on_disk_propagates_read_error_for_missing_file_named_section() {
    let dir = tempdir();
    let path = dir.join("missing.toml");
    let err = reset_section_on_disk(&path, Some("chat")).unwrap_err();
    matches!(err, ConfigError::IoError { .. });
}

#[cfg(unix)]
#[test]
fn reset_section_on_disk_propagates_io_error_when_parent_dir_is_readonly() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let mut perms = std::fs::metadata(&dir).unwrap().permissions();
    perms.set_mode(0o500);
    std::fs::set_permissions(&dir, perms.clone()).unwrap();

    let err = reset_section_on_disk(&path, Some("chat")).unwrap_err();

    let mut restore = perms;
    restore.set_mode(0o700);
    std::fs::set_permissions(&dir, restore).unwrap();

    matches!(err, ConfigError::IoError { .. });
}

#[cfg(unix)]
#[test]
fn reset_section_on_disk_whole_file_propagates_io_error_when_parent_dir_is_readonly() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let mut perms = std::fs::metadata(&dir).unwrap().permissions();
    perms.set_mode(0o500);
    std::fs::set_permissions(&dir, perms.clone()).unwrap();

    let err = reset_section_on_disk(&path, None).unwrap_err();

    let mut restore = perms;
    restore.set_mode(0o700);
    std::fs::set_permissions(&dir, restore).unwrap();

    matches!(err, ConfigError::IoError { .. });
}

/// Windows counterpart for the section-reset write-error branch (read-only
/// target blocks the rename swap).
#[cfg(windows)]
#[test]
// `set_readonly(false)` is meaningful on Windows; the lint guards against the
// misleading no-op on Unix.
#[allow(clippy::permissions_set_readonly_false)]
fn reset_section_on_disk_propagates_io_error_when_target_is_readonly() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms).unwrap();

    let err = reset_section_on_disk(&path, Some("chat")).unwrap_err();

    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(false);
    let _ = std::fs::set_permissions(&path, perms);

    matches!(err, ConfigError::IoError { .. });
}

/// Windows counterpart for the whole-file reset write-error branch.
#[cfg(windows)]
#[test]
// `set_readonly(false)` is meaningful on Windows; the lint guards against the
// misleading no-op on Unix.
#[allow(clippy::permissions_set_readonly_false)]
fn reset_section_on_disk_whole_file_propagates_io_error_when_target_is_readonly() {
    let dir = tempdir();
    let path = dir.join("config.toml");
    std::fs::write(&path, SAMPLE_CONFIG).unwrap();

    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms).unwrap();

    let err = reset_section_on_disk(&path, None).unwrap_err();

    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(false);
    let _ = std::fs::set_permissions(&path, perms);

    matches!(err, ConfigError::IoError { .. });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn matches_type_mismatch(err: &ConfigError, section: &str, key: &str) {
    match err {
        ConfigError::TypeMismatch {
            section: s, key: k, ..
        } => {
            assert_eq!(s, section);
            assert_eq!(k, key);
        }
        other => panic!("expected TypeMismatch on {section}.{key}, got {other:?}"),
    }
}

/// Unique per-test directory under the OS temp dir so concurrent tests do not
/// collide. Cleanup is the OS's responsibility (these are `cargo test` runs,
/// not production code).
fn tempdir() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("quickai-settings-cmd-{pid}-{nanos}-{n}"));
    std::fs::create_dir_all(&dir).expect("create tempdir");
    dir
}
