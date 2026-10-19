//! Tests for the `skills` module.
//!
//! Every branch of the store (load/save/validate/seed) and of the prompt
//! composition helpers is exercised against temporary directories. The Tauri
//! command wrappers are coverage-excluded; their logic lives in the functions
//! tested here.

use std::path::{Path, PathBuf};

use super::{
    append_enabled_skills, append_skills_by_alias, builtin_skill, ensure_builtin_file, load,
    normalize_skill_path, save, validate, Skill, SkillError, SkillReadFailure,
    BUILTIN_ASSISTANT_ALIAS, BUILTIN_ASSISTANT_FILE_NAME, BUILTIN_ASSISTANT_ID,
    BUILTIN_ASSISTANT_TEXT, SKILLS_FILE_NAME,
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

/// Unique per-test temp directory so concurrent tests do not collide.
fn tempdir() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("quickai-skills-{pid}-{nanos}-{n}"));
    std::fs::create_dir_all(&dir).expect("create tempdir");
    dir
}

/// Writes `text` to `dir/name` and returns the path.
fn write_file(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, text).unwrap();
    path
}

fn skill(id: &str, alias: &str, path: &str, enabled: bool) -> Skill {
    Skill {
        id: id.to_string(),
        alias: alias.to_string(),
        path: path.to_string(),
        enabled,
    }
}

// ─── validate ────────────────────────────────────────────────────────────────

#[test]
fn validate_accepts_builtin_only() {
    let s = vec![builtin_skill(Path::new("/cfg"))];
    assert!(validate(&s).is_ok());
}

#[test]
fn validate_accepts_builtin_plus_custom() {
    let s = vec![
        builtin_skill(Path::new("/cfg")),
        skill("x", "translate", "/tmp/t.md", false),
    ];
    assert!(validate(&s).is_ok());
}

#[test]
fn validate_rejects_missing_builtin() {
    let s = vec![skill("x", "translate", "/tmp/t.md", false)];
    assert!(matches!(validate(&s), Err(SkillError::BuiltinNotDeletable)));
}

#[test]
fn validate_rejects_empty_alias() {
    let s = vec![
        builtin_skill(Path::new("/cfg")),
        skill("x", "   ", "/tmp/t.md", false),
    ];
    assert!(matches!(validate(&s), Err(SkillError::EmptyAlias)));
}

#[test]
fn validate_rejects_whitespace_alias() {
    let s = vec![
        builtin_skill(Path::new("/cfg")),
        skill("x", "trans late", "/tmp/t.md", false),
    ];
    match validate(&s) {
        Err(SkillError::AliasHasWhitespace { alias }) => assert_eq!(alias, "trans late"),
        other => panic!("expected AliasHasWhitespace, got {other:?}"),
    }
}

#[test]
fn validate_rejects_duplicate_alias() {
    let s = vec![
        builtin_skill(Path::new("/cfg")),
        skill("a", "translate", "/tmp/a.md", false),
        skill("b", "translate", "/tmp/b.md", false),
    ];
    match validate(&s) {
        Err(SkillError::DuplicateAlias { alias }) => assert_eq!(alias, "translate"),
        other => panic!("expected DuplicateAlias, got {other:?}"),
    }
}

/// A builtin + one custom skill carrying `path`: the smallest list that reaches
/// `validate`'s per-skill path checks.
fn list_with_path(path: &str) -> Vec<Skill> {
    vec![
        builtin_skill(Path::new("/cfg")),
        skill("x", "translate", path, false),
    ]
}

#[test]
fn validate_accepts_supported_text_extensions() {
    let dir = tempdir();
    for name in ["t.txt", "t.md", "t.markdown"] {
        let path = dir.join(name).display().to_string();
        assert!(validate(&list_with_path(&path)).is_ok(), "{name}");
    }
}

#[test]
fn validate_accepts_extensions_case_insensitively() {
    let dir = tempdir();
    for name in ["T.MD", "T.Markdown", "T.TXT"] {
        let path = dir.join(name).display().to_string();
        assert!(validate(&list_with_path(&path)).is_ok(), "{name}");
    }
}

#[test]
fn validate_accepts_a_normalised_quoted_path() {
    // Item 9: `save` normalises before validating, so `validate` only ever sees
    // the unquoted form. The Windows-style string is a single path component on
    // Linux, where its extension still resolves to `.md`.
    let windows_style = "\"D:\\Program Files\\QuickAI\\skills\\test.md\"";
    let normalised = normalize_skill_path(windows_style);
    assert_eq!(normalised, "D:\\Program Files\\QuickAI\\skills\\test.md");
    assert!(validate(&list_with_path(&normalised)).is_ok());

    let dir = tempdir();
    let file = write_file(&dir, "quoted.md", "text");
    let quoted = format!("\"{}\"", file.display());
    assert!(validate(&list_with_path(&normalize_skill_path(&quoted))).is_ok());
}

#[test]
fn validate_rejects_an_empty_path() {
    // `validate` receives the normalised path, so the empty string is the only
    // form it can see; the raw spellings are covered by
    // `save_rejects_an_empty_path`.
    match validate(&list_with_path("")) {
        Err(SkillError::EmptyPath) => {}
        other => panic!("expected EmptyPath, got {other:?}"),
    }
}

#[test]
fn validate_rejects_a_path_still_wrapped_in_quotes() {
    // What one strip can leave behind: a doubled pair, an unbalanced leading
    // quote, and an unbalanced trailing quote. None can be a usable path.
    for path in ["\"a.md\"", "\"a.md", "a.md\""] {
        match validate(&list_with_path(path)) {
            Err(SkillError::StrayQuote) => {}
            other => panic!("expected StrayQuote for {path:?}, got {other:?}"),
        }
    }
}

#[test]
fn validate_rejects_a_directory() {
    let dir = tempdir();
    // A directory is refused even when it is named like a text file. The check
    // is a plain `is_dir` boolean, so it behaves identically on every OS.
    let folder = dir.join("a-folder.md");
    std::fs::create_dir(&folder).unwrap();
    match validate(&list_with_path(&folder.display().to_string())) {
        Err(SkillError::PathNotAFile) => {}
        other => panic!("expected PathNotAFile, got {other:?}"),
    }
}

#[test]
fn validate_rejects_unsupported_extensions() {
    let dir = tempdir();
    // A PDF, a spreadsheet, a document, and an extensionless file are refused.
    for name in ["t.pdf", "t.xlsx", "t.docx", "t"] {
        let path = dir.join(name).display().to_string();
        match validate(&list_with_path(&path)) {
            Err(SkillError::UnsupportedFormat { .. }) => {}
            other => panic!("expected UnsupportedFormat for {name}, got {other:?}"),
        }
    }
}

#[test]
fn validate_reports_the_offending_extension() {
    let dir = tempdir();
    // The reported extension is lowercased so the frontend can show it.
    let upper = dir.join("t.PDF").display().to_string();
    match validate(&list_with_path(&upper)) {
        Err(SkillError::UnsupportedFormat { extension }) => assert_eq!(extension, "pdf"),
        other => panic!("expected UnsupportedFormat, got {other:?}"),
    }
    // A file with no extension at all reports an empty extension.
    let bare = dir.join("t").display().to_string();
    match validate(&list_with_path(&bare)) {
        Err(SkillError::UnsupportedFormat { extension }) => assert_eq!(extension, ""),
        other => panic!("expected UnsupportedFormat, got {other:?}"),
    }
}

// ─── normalize_skill_path ────────────────────────────────────────────────────

#[test]
fn normalize_path_trims_and_strips_one_quote_pair() {
    assert_eq!(normalize_skill_path("  /tmp/t.md  "), "/tmp/t.md");
    assert_eq!(normalize_skill_path("\"/tmp/t.md\""), "/tmp/t.md");
    assert_eq!(normalize_skill_path("'/tmp/t.md'"), "/tmp/t.md");
    assert_eq!(normalize_skill_path("“/tmp/t.md”"), "/tmp/t.md");
    assert_eq!(normalize_skill_path("‘/tmp/t.md’"), "/tmp/t.md");
    // A straight-open / curly-close mix, as a paste can produce.
    assert_eq!(normalize_skill_path("\"/tmp/t.md”"), "/tmp/t.md");
    // Whitespace inside the quotes is trimmed as well.
    assert_eq!(normalize_skill_path("\"  /tmp/t.md  \""), "/tmp/t.md");
}

#[test]
fn normalize_path_strips_only_one_pair() {
    // Only the outermost pair goes; an inner pair is part of the value.
    assert_eq!(normalize_skill_path("\"\"x\"\""), "\"x\"");
}

#[test]
fn normalize_path_leaves_an_unquoted_path_alone() {
    assert_eq!(normalize_skill_path("/tmp/t.md"), "/tmp/t.md");
    // A quote that is not a surrounding pair is part of the path.
    assert_eq!(normalize_skill_path("/tmp/a\"b.md"), "/tmp/a\"b.md");
    assert_eq!(
        normalize_skill_path("D:\\Program Files\\a b\\t.md"),
        "D:\\Program Files\\a b\\t.md"
    );
}

#[test]
fn normalize_path_handles_short_and_empty_input() {
    assert_eq!(normalize_skill_path(""), "");
    assert_eq!(normalize_skill_path("   "), "");
    // A lone quote is shorter than a pair, so it is left unchanged.
    assert_eq!(normalize_skill_path("\""), "\"");
    assert_eq!(normalize_skill_path("x"), "x");
}

// ─── builtin_skill ───────────────────────────────────────────────────────────

#[test]
fn builtin_skill_has_fixed_identity_and_path_in_config_dir() {
    let s = builtin_skill(Path::new("/cfg"));
    assert_eq!(s.id, BUILTIN_ASSISTANT_ID);
    assert_eq!(s.alias, BUILTIN_ASSISTANT_ALIAS);
    assert!(s.enabled);
    assert_eq!(
        s.path,
        Path::new("/cfg")
            .join(BUILTIN_ASSISTANT_FILE_NAME)
            .display()
            .to_string()
    );
}

// ─── load ────────────────────────────────────────────────────────────────────

#[test]
fn load_missing_file_seeds_builtin_and_files() {
    let dir = tempdir();
    let skills = load(&dir).expect("seed on first use");

    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].id, BUILTIN_ASSISTANT_ID);
    assert!(dir.join(SKILLS_FILE_NAME).exists(), "skills.toml seeded");
    assert!(
        dir.join(BUILTIN_ASSISTANT_FILE_NAME).exists(),
        "built-in file seeded"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join(BUILTIN_ASSISTANT_FILE_NAME)).unwrap(),
        BUILTIN_ASSISTANT_TEXT
    );
}

#[test]
fn load_existing_valid_store_is_not_rewritten() {
    let dir = tempdir();
    let path = dir.join(SKILLS_FILE_NAME);
    let contents = format!(
        "# keep me\n[[skills]]\nid = \"{BUILTIN_ASSISTANT_ID}\"\nalias = \"{BUILTIN_ASSISTANT_ALIAS}\"\npath = \"x.md\"\nenabled = true\n"
    );
    std::fs::write(&path, &contents).unwrap();

    let skills = load(&dir).unwrap();
    assert_eq!(skills.len(), 1);
    // Untouched: no repair was needed, so the file keeps its comment.
    assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
}

#[test]
fn load_store_without_builtin_prepends_and_persists() {
    let dir = tempdir();
    let path = dir.join(SKILLS_FILE_NAME);
    std::fs::write(
        &path,
        "[[skills]]\nid = \"x\"\nalias = \"translate\"\npath = \"t.md\"\nenabled = false\n",
    )
    .unwrap();

    let skills = load(&dir).unwrap();
    assert_eq!(skills.len(), 2);
    assert_eq!(skills[0].id, BUILTIN_ASSISTANT_ID);
    assert_eq!(skills[1].alias, "translate");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains(BUILTIN_ASSISTANT_ID));
}

#[test]
fn load_corrupt_store_is_reseeded() {
    let dir = tempdir();
    std::fs::write(dir.join(SKILLS_FILE_NAME), "this is not = valid [[[ toml").unwrap();

    let skills = load(&dir).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].id, BUILTIN_ASSISTANT_ID);
}

#[test]
fn load_read_error_is_surfaced() {
    let dir = tempdir();
    // A directory squatting on the store path makes `read_to_string` fail with
    // a non-`NotFound` error on every platform.
    std::fs::create_dir(dir.join(SKILLS_FILE_NAME)).unwrap();

    match load(&dir) {
        Err(SkillError::IoError { path, .. }) => assert_eq!(path, dir.join(SKILLS_FILE_NAME)),
        other => panic!("expected IoError, got {other:?}"),
    }
}

#[test]
fn load_propagates_unusable_config_dir_failure() {
    let dir = tempdir();
    // A regular file where the config dir should be leaves the store path
    // unreadable and the built-in file unseeded. Which of the two fails first is
    // platform-specific: Linux reports `ENOTDIR` on the store read and returns
    // there, while Windows maps it to `NotFound` and fails later while seeding.
    // Assert only the invariant both share: the failure is surfaced as an I/O
    // error naming a file inside the config dir, never swallowed.
    let blocker = write_file(&dir, "not-a-dir", "x");

    match load(&blocker) {
        Err(SkillError::IoError { path, .. }) => {
            assert_eq!(
                path.parent(),
                Some(blocker.as_path()),
                "error names a file inside the config dir, got {path:?}"
            );
            let name = path.file_name().and_then(|n| n.to_str());
            assert!(
                name == Some(SKILLS_FILE_NAME) || name == Some(BUILTIN_ASSISTANT_FILE_NAME),
                "unexpected failing file: {path:?}"
            );
        }
        other => panic!("expected IoError, got {other:?}"),
    }
}

// ─── save ────────────────────────────────────────────────────────────────────

#[test]
fn save_persists_and_returns_list() {
    let dir = tempdir();
    let list = vec![builtin_skill(&dir), skill("x", "translate", "t.md", true)];
    let saved = save(&dir, list.clone()).unwrap();
    assert_eq!(saved, list);

    // Round-trips through load.
    let reloaded = load(&dir).unwrap();
    assert_eq!(reloaded, list);
}

#[test]
fn save_rejects_invalid_list_without_writing() {
    let dir = tempdir();
    let list = vec![skill("x", "translate", "t.md", false)];
    assert!(matches!(
        save(&dir, list),
        Err(SkillError::BuiltinNotDeletable)
    ));
    assert!(!dir.join(SKILLS_FILE_NAME).exists(), "nothing written");
}

#[test]
fn save_write_error_is_surfaced() {
    let dir = tempdir();
    // A non-empty directory on the store path makes the atomic rename fail,
    // while the built-in file still seeds cleanly.
    let target = dir.join(SKILLS_FILE_NAME);
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("filler"), "x").unwrap();

    match save(&dir, vec![builtin_skill(&dir)]) {
        Err(SkillError::IoError { path, .. }) => assert_eq!(path, target),
        other => panic!("expected IoError, got {other:?}"),
    }
}

#[test]
fn save_propagates_builtin_file_seed_failure() {
    let dir = tempdir();
    let blocker = write_file(&dir, "not-a-dir", "x");
    match save(&blocker, vec![builtin_skill(&blocker)]) {
        Err(SkillError::IoError { path, .. }) => {
            assert_eq!(path, blocker.join(BUILTIN_ASSISTANT_FILE_NAME))
        }
        other => panic!("expected IoError, got {other:?}"),
    }
}

#[test]
fn save_persists_the_normalised_path() {
    let dir = tempdir();
    let file = write_file(&dir, "s.md", "text");
    let quoted = format!("\"{}\"", file.display());
    let list = vec![builtin_skill(&dir), skill("x", "translate", &quoted, false)];

    // The returned list and the store on disk both hold the bare path, not the
    // quoted paste the frontend submitted.
    let saved = save(&dir, list).unwrap();
    assert_eq!(saved[1].path, file.display().to_string());

    let reloaded = load(&dir).unwrap();
    assert_eq!(reloaded[1].path, file.display().to_string());
}

#[test]
fn save_rejects_an_empty_path() {
    let dir = tempdir();
    // The raw spellings a user can submit, all of which normalise to empty.
    for raw in ["", "   ", "\"\"", "  \"\"  "] {
        let list = vec![builtin_skill(&dir), skill("x", "translate", raw, false)];
        match save(&dir, list) {
            Err(SkillError::EmptyPath) => {}
            other => panic!("expected EmptyPath for {raw:?}, got {other:?}"),
        }
    }
    assert!(!dir.join(SKILLS_FILE_NAME).exists(), "nothing written");
}

#[test]
fn save_rejects_a_doubled_quote_pair() {
    let dir = tempdir();
    // One strip leaves `"a.md"`, whose extension would be `md"`. It must be
    // rejected rather than silently stored as a path that is unreadable later.
    let list = vec![
        builtin_skill(&dir),
        skill("x", "translate", "\"\"a.md\"\"", false),
    ];
    match save(&dir, list) {
        Err(SkillError::StrayQuote) => {}
        other => panic!("expected StrayQuote, got {other:?}"),
    }
    assert!(!dir.join(SKILLS_FILE_NAME).exists(), "nothing written");
}

// ─── ensure_builtin_file ─────────────────────────────────────────────────────

#[test]
fn ensure_builtin_file_seeds_then_leaves_existing_alone() {
    let dir = tempdir();
    let path = dir.join(BUILTIN_ASSISTANT_FILE_NAME);

    ensure_builtin_file(&dir).unwrap();
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        BUILTIN_ASSISTANT_TEXT
    );

    // A user edit is preserved on the next ensure.
    std::fs::write(&path, "user edit").unwrap();
    ensure_builtin_file(&dir).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "user edit");
}

#[test]
fn ensure_builtin_file_failure_is_surfaced() {
    let dir = tempdir();
    let blocker = write_file(&dir, "not-a-dir", "x");
    match ensure_builtin_file(&blocker) {
        Err(SkillError::IoError { path, .. }) => {
            assert_eq!(path, blocker.join(BUILTIN_ASSISTANT_FILE_NAME))
        }
        other => panic!("expected IoError, got {other:?}"),
    }
}

// ─── append_enabled_skills ───────────────────────────────────────────────────

#[test]
fn append_enabled_appends_readable_enabled_skill() {
    let dir = tempdir();
    let path = write_file(&dir, "translate.md", "Translate carefully.\n");
    let skills = vec![skill("x", "translate", &path.display().to_string(), true)];

    let (composed, failures) = append_enabled_skills("BASE", &skills);
    assert_eq!(composed, "BASE\n\nTranslate carefully.");
    assert!(failures.is_empty());
}

#[test]
fn append_enabled_skips_disabled_and_empty_skills() {
    let dir = tempdir();
    let disabled = write_file(&dir, "off.md", "not used");
    let empty = write_file(&dir, "empty.md", "   \n");
    let skills = vec![
        skill("a", "off", &disabled.display().to_string(), false),
        skill("b", "empty", &empty.display().to_string(), true),
    ];

    let (composed, failures) = append_enabled_skills("BASE", &skills);
    assert_eq!(composed, "BASE");
    assert!(failures.is_empty());
}

#[test]
fn append_enabled_reports_unreadable_skill_without_failing() {
    let dir = tempdir();
    let missing = dir.join("nope.md");
    let skills = vec![skill(
        "x",
        "translate",
        &missing.display().to_string(),
        true,
    )];

    let (composed, failures) = append_enabled_skills("BASE", &skills);
    assert_eq!(composed, "BASE");
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].alias, "translate");
    assert!(failures[0].detail().contains("translate"));
    assert!(failures[0].detail().contains("nope.md"));
}

#[test]
fn append_enabled_uses_empty_base_without_leading_separator() {
    let dir = tempdir();
    let path = write_file(&dir, "s.md", "text");
    let skills = vec![skill("x", "s", &path.display().to_string(), true)];

    let (composed, _) = append_enabled_skills("", &skills);
    assert_eq!(composed, "text");
}

// ─── append_skills_by_alias ──────────────────────────────────────────────────

#[test]
fn append_by_alias_appends_named_skill() {
    let dir = tempdir();
    let path = write_file(&dir, "t.md", "Translate.");
    let skills = vec![skill("x", "translate", &path.display().to_string(), false)];

    let (composed, failures) = append_skills_by_alias("ASK", &skills, &["translate".to_string()]);
    assert_eq!(composed, "ASK\n\nTranslate.");
    assert!(failures.is_empty());
}

#[test]
fn append_by_alias_skips_empty_file() {
    let dir = tempdir();
    let path = write_file(&dir, "t.md", "\n  \n");
    let skills = vec![skill("x", "translate", &path.display().to_string(), false)];

    let (composed, failures) = append_skills_by_alias("ASK", &skills, &["translate".to_string()]);
    assert_eq!(composed, "ASK");
    assert!(failures.is_empty());
}

#[test]
fn append_by_alias_reports_unknown_alias() {
    let (composed, failures) = append_skills_by_alias("ASK", &[], &["ghost".to_string()]);
    assert_eq!(composed, "ASK");
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].alias, "ghost");
    assert_eq!(failures[0].detail(), "no skill named \"ghost\"");
}

#[test]
fn append_by_alias_reports_unreadable_skill() {
    let dir = tempdir();
    let missing = dir.join("nope.md");
    let skills = vec![skill(
        "x",
        "translate",
        &missing.display().to_string(),
        false,
    )];

    let (composed, failures) = append_skills_by_alias("ASK", &skills, &["translate".to_string()]);
    assert_eq!(composed, "ASK");
    assert_eq!(failures.len(), 1);
    assert!(failures[0].detail().contains("not readable"));
}

// ─── SkillReadFailure ────────────────────────────────────────────────────────

#[test]
fn skill_read_failure_detail_covers_every_shape() {
    let unknown = SkillReadFailure {
        alias: "ghost".to_string(),
        path: String::new(),
        message: "unknown alias".to_string(),
    };
    assert_eq!(unknown.detail(), "no skill named \"ghost\"");

    let unreadable = SkillReadFailure {
        alias: "translate".to_string(),
        path: "/x/t.md".to_string(),
        message: "denied".to_string(),
    };
    assert_eq!(
        unreadable.detail(),
        "skill \"translate\" (/x/t.md) is not readable: denied"
    );

    // A store-level failure carries no alias, so the message is shown as-is.
    assert_eq!(
        SkillReadFailure::store("skills store could not be read").detail(),
        "skills store could not be read"
    );
}

// ─── error serialization ─────────────────────────────────────────────────────

/// Exercises the `thiserror` `Display` derives so their generated arms are
/// covered, and asserts the messages carry useful context.
#[test]
fn skill_error_display_messages_include_context() {
    assert_eq!(
        SkillError::EmptyAlias.to_string(),
        "skill alias must not be empty"
    );
    assert!(SkillError::AliasHasWhitespace {
        alias: "a b".to_string()
    }
    .to_string()
    .contains("a b"));
    assert!(SkillError::DuplicateAlias {
        alias: "x".to_string()
    }
    .to_string()
    .contains("x"));
    assert!(SkillError::BuiltinNotDeletable
        .to_string()
        .contains("built-in"));
    assert!(SkillError::IoError {
        path: PathBuf::from("/tmp/skills.toml"),
        source: std::io::Error::other("boom"),
    }
    .to_string()
    .contains("/tmp/skills.toml"));

    assert!(SkillError::EmptyPath.to_string().contains("empty"));
    assert!(SkillError::PathNotAFile.to_string().contains("file"));
    assert!(SkillError::StrayQuote.to_string().contains("quote"));
    assert!(SkillError::UnsupportedFormat {
        extension: "pdf".to_string(),
    }
    .to_string()
    .contains("pdf"));
}

#[test]
fn skill_error_serializes_with_kind_and_io_detail() {
    let json = serde_json::to_value(SkillError::DuplicateAlias {
        alias: "x".to_string(),
    })
    .unwrap();
    assert_eq!(json["kind"], "duplicate_alias");
    assert_eq!(json["alias"], "x");

    let io = SkillError::IoError {
        path: PathBuf::from("/tmp/skills.toml"),
        source: std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied here"),
    };
    let json = serde_json::to_value(&io).unwrap();
    assert_eq!(json["kind"], "io_error");
    assert_eq!(json["path"], "/tmp/skills.toml");
    assert_eq!(json["source"], "denied here");

    // Remaining variants serialize with their kind tags.
    assert_eq!(
        serde_json::to_value(SkillError::EmptyAlias).unwrap()["kind"],
        "empty_alias"
    );
    assert_eq!(
        serde_json::to_value(SkillError::BuiltinNotDeletable).unwrap()["kind"],
        "builtin_not_deletable"
    );
    assert_eq!(
        serde_json::to_value(SkillError::AliasHasWhitespace {
            alias: "a b".to_string()
        })
        .unwrap()["kind"],
        "alias_has_whitespace"
    );
    assert_eq!(
        serde_json::to_value(SkillError::EmptyPath).unwrap()["kind"],
        "empty_path"
    );
    assert_eq!(
        serde_json::to_value(SkillError::PathNotAFile).unwrap()["kind"],
        "path_not_a_file"
    );
    assert_eq!(
        serde_json::to_value(SkillError::StrayQuote).unwrap()["kind"],
        "stray_quote"
    );
    let unsupported = serde_json::to_value(SkillError::UnsupportedFormat {
        extension: "pdf".to_string(),
    })
    .unwrap();
    assert_eq!(unsupported["kind"], "unsupported_format");
    assert_eq!(unsupported["extension"], "pdf");
}
