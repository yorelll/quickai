//! User-defined skills: instruction files appended to the chat prompt.
//!
//! Skills live in a dedicated `skills.toml` in the config directory (an array
//! of `[[skills]]` tables), deliberately kept out of `AppConfig` so the config
//! writer's per-field patching is untouched. A [`Skill`] points at a file whose
//! contents are the skill text.
//!
//! A skill reaches the model in one of two ways:
//! - `enabled: true` — its file's contents are appended to the system prompt on
//!   every turn (see [`append_enabled_skills`]).
//! - named in `ask`'s `skills` aliases — its contents are appended to that
//!   turn's prompt only (see [`append_skills_by_alias`]).
//!
//! A built-in assistant skill is seeded on first use, lives in the config
//! directory, and cannot be deleted (see [`save`]). Unreadable skill files
//! never fail a turn: they are reported as [`SkillReadFailure`]s so the
//! frontend can surface them.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// File name of the skills store inside the config directory.
pub const SKILLS_FILE_NAME: &str = "skills.toml";
/// Stable id of the built-in assistant skill. Deleting this id is rejected.
pub const BUILTIN_ASSISTANT_ID: &str = "builtin-assistant";
/// Default alias of the built-in assistant skill.
pub const BUILTIN_ASSISTANT_ALIAS: &str = "assistant";
/// File name of the built-in assistant skill's text inside the config directory.
pub const BUILTIN_ASSISTANT_FILE_NAME: &str = "assistant.md";
/// Seed text for the built-in assistant skill file. Kept concise and additive:
/// the core persona already forms the base system prompt, so this file adds
/// operational guidance rather than repeating the persona.
pub const BUILTIN_ASSISTANT_TEXT: &str = "\
# Built-in assistant

You are QuickAI's built-in assistant. Apply the persona and behavioural
guidelines in the base system prompt to every reply.

- Lead with the answer; add reasoning only when it changes the reader's decision.
- Be direct and honest. Flag uncertainty in a clause rather than hedging throughout.
- Keep replies as short as the question allows.
- When an obviously useful follow-up exists, mention it in one sentence.";

/// Extensions accepted for a skill file, compared case-insensitively. A skill
/// file is read as plain text, so only text formats are allowed; a folder, a
/// PDF, or a spreadsheet is refused at save time rather than failing at use
/// time.
const ALLOWED_SKILL_EXTENSIONS: [&str; 3] = ["txt", "md", "markdown"];

/// A single user-defined skill.
///
/// `id` is a stable opaque identifier (the built-in assistant id is fixed);
/// `alias` is the human-facing name used to select the skill in chat, and must
/// be non-empty, whitespace-free, and unique; `path` is a file whose contents
/// are the skill text; `enabled` marks a skill for the system prompt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Skill {
    pub id: String,
    pub alias: String,
    pub path: String,
    pub enabled: bool,
}

/// On-disk shape of `skills.toml`: an array of `[[skills]]` tables.
#[derive(Debug, Serialize, Deserialize)]
struct SkillsFile {
    #[serde(default)]
    skills: Vec<Skill>,
}

/// Errors returned by the skills store. Serialized across the IPC boundary as
/// a tagged enum (`{ "kind": "duplicate_alias", "alias": "..." }`) so the
/// Settings UI can render typed inline errors.
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SkillError {
    /// A skill alias was empty (or only whitespace).
    #[error("skill alias must not be empty")]
    EmptyAlias,
    /// A skill alias contained whitespace. Aliases may not contain spaces.
    #[error("skill alias must not contain whitespace: {alias}")]
    AliasHasWhitespace { alias: String },
    /// Two skills shared an alias.
    #[error("duplicate skill alias: {alias}")]
    DuplicateAlias { alias: String },
    /// The submitted list omitted the built-in assistant skill, which is not
    /// deletable.
    #[error("the built-in assistant skill cannot be deleted")]
    BuiltinNotDeletable,
    /// A skill path was empty after trimming and unquoting.
    #[error("skill path must not be empty")]
    EmptyPath,
    /// A skill path pointed at a directory rather than a file.
    #[error("skill path must be a file, not a directory")]
    PathNotAFile,
    /// A skill path still carried a surrounding quote after the one pair was
    /// stripped — a doubled `""a.md""` or an unbalanced `"a.md` — so it cannot
    /// be a usable path.
    #[error("skill path must not start or end with a quote character")]
    StrayQuote,
    /// A skill file's extension is not one of the supported text formats.
    #[error("unsupported skill file format: {extension}")]
    UnsupportedFormat { extension: String },
    /// Filesystem failure reading or writing the skills store.
    #[error("skills file I/O error at {path}: {source}")]
    IoError {
        path: PathBuf,
        #[serde(serialize_with = "serialize_io_error")]
        source: std::io::Error,
    },
}

/// Serializes a `std::io::Error` as its `Display` string for IPC. Mirrors the
/// helper in `config::error`; the frontend only needs the human-readable text.
fn serialize_io_error<S>(err: &std::io::Error, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&err.to_string())
}

/// Returns the built-in assistant skill, with its file path inside `config_dir`.
pub fn builtin_skill(config_dir: &Path) -> Skill {
    Skill {
        id: BUILTIN_ASSISTANT_ID.to_string(),
        alias: BUILTIN_ASSISTANT_ALIAS.to_string(),
        path: config_dir
            .join(BUILTIN_ASSISTANT_FILE_NAME)
            .display()
            .to_string(),
        enabled: true,
    }
}

/// Validates a whole skill list. Every alias must be non-empty, contain no
/// whitespace, and be unique; the built-in assistant id must be present
/// (deleting it is rejected). Every path must be a non-empty string naming a
/// file with a supported text extension — a folder, a binary document, or a
/// value still wrapped in quotes is rejected here, at save time, rather than at
/// use time.
///
/// Paths are expected to be **already normalised** (see [`normalize_skill_path`]).
/// [`save`] is the single normalisation boundary: it trims and strips the
/// surrounding quotes before calling this, so the validated value is exactly the
/// value persisted. Do not normalise a second time here — see
/// [`validate_skill_path`].
pub fn validate(skills: &[Skill]) -> Result<(), SkillError> {
    if !skills.iter().any(|s| s.id == BUILTIN_ASSISTANT_ID) {
        return Err(SkillError::BuiltinNotDeletable);
    }
    let mut seen: Vec<&str> = Vec::with_capacity(skills.len());
    for skill in skills {
        let alias = skill.alias.as_str();
        if alias.trim().is_empty() {
            return Err(SkillError::EmptyAlias);
        }
        if alias.chars().any(char::is_whitespace) {
            return Err(SkillError::AliasHasWhitespace {
                alias: alias.to_string(),
            });
        }
        if seen.contains(&alias) {
            return Err(SkillError::DuplicateAlias {
                alias: alias.to_string(),
            });
        }
        seen.push(alias);
        validate_skill_path(&skill.path)?;
    }
    Ok(())
}

/// Checks one **already-normalised** skill path's shape: non-empty, not still
/// wrapped in a quote character, not a directory, and carrying a supported text
/// extension.
///
/// `path` must come from [`normalize_skill_path`]; [`save`] is the single
/// normalisation boundary and calls this only after normalising, so the value
/// checked here is exactly the value persisted. Do **not** normalise again
/// inside here — a second strip would validate a different string from the one
/// written to disk (a doubled `""a.md""` would validate as `a.md` yet persist
/// as `"a.md"`). The file need not exist — a user may add a skill before
/// creating its file — so only the shape is checked; readability remains the
/// backstop at use time ([`read_skill`]).
fn validate_skill_path(path: &str) -> Result<(), SkillError> {
    if path.is_empty() {
        return Err(SkillError::EmptyPath);
    }
    if has_surrounding_quote(path) {
        return Err(SkillError::StrayQuote);
    }
    if Path::new(path).is_dir() {
        return Err(SkillError::PathNotAFile);
    }
    match skill_extension(path) {
        Some(extension) if ALLOWED_SKILL_EXTENSIONS.contains(&extension.as_str()) => Ok(()),
        Some(extension) => Err(SkillError::UnsupportedFormat { extension }),
        None => Err(SkillError::UnsupportedFormat {
            extension: String::new(),
        }),
    }
}

/// Whether `s` begins or ends with a quote character. After [`save`] has
/// stripped one surrounding pair, a remaining leading or trailing quote means
/// the input was never a plain path — a doubled pair (`""a.md""`) or an
/// unbalanced one (`"a.md`) — and cannot be used on any platform we ship.
fn has_surrounding_quote(s: &str) -> bool {
    s.chars().next().is_some_and(is_quote) || s.chars().next_back().is_some_and(is_quote)
}

/// Whether `c` is any quote character [`strip_one_quote_pair`] recognises.
fn is_quote(c: char) -> bool {
    matches!(c, '"' | '\'' | '“' | '‘' | '”' | '’')
}

/// The lowercased extension of `path`, or `None` when it has none.
fn skill_extension(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

/// Normalises a user-supplied skill path for storage and validation: trims
/// surrounding whitespace and strips one pair of surrounding quotes.
///
/// Users paste a path straight from Explorer — `"D:\Program Files\…\test.md"`
/// — or from a document editor, which wraps it in curly quotes (`“…”`). The
/// stored value must be the bare path, so the quotes are removed here, in the
/// backend, and it is the normalised value that gets persisted (see [`save`]).
fn normalize_skill_path(raw: &str) -> String {
    strip_one_quote_pair(raw.trim()).trim().to_string()
}

/// Strips a single matching pair of surrounding quotes, if present. Accepts the
/// straight `"`/`'` and curly `“”`/`‘’` pairs, including a straight-open /
/// curly-close mix that pasting can produce. A string shorter than two
/// characters is returned unchanged.
fn strip_one_quote_pair(s: &str) -> &str {
    let mut chars = s.chars();
    let (Some(first), Some(last)) = (chars.next(), chars.next_back()) else {
        return s;
    };
    if is_opening_quote(first) && is_closing_quote(last) {
        &s[first.len_utf8()..s.len() - last.len_utf8()]
    } else {
        s
    }
}

fn is_opening_quote(c: char) -> bool {
    matches!(c, '"' | '\'' | '“' | '‘')
}

fn is_closing_quote(c: char) -> bool {
    matches!(c, '"' | '\'' | '”' | '’')
}

/// Loads the skill list from `config_dir/skills.toml`, seeding the built-in
/// assistant skill on first use.
///
/// A missing or unparsable file is treated as an empty list and re-seeded; a
/// list that does not contain the built-in assistant has it prepended. The
/// result is persisted whenever the store had to be repaired.
pub fn load(config_dir: &Path) -> Result<Vec<Skill>, SkillError> {
    let path = config_dir.join(SKILLS_FILE_NAME);
    let (mut skills, mut needs_persist) = match std::fs::read_to_string(&path) {
        Ok(text) => match toml::from_str::<SkillsFile>(&text) {
            Ok(file) => (file.skills, false),
            // A corrupt store is repaired by reseeding rather than failing.
            Err(_) => (Vec::new(), true),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Vec::new(), true),
        Err(source) => return Err(SkillError::IoError { path, source }),
    };

    if !skills.iter().any(|s| s.id == BUILTIN_ASSISTANT_ID) {
        skills.insert(0, builtin_skill(config_dir));
        needs_persist = true;
    }

    // Seed the built-in skill's file so its path is readable out of the box.
    // An existing file is never overwritten (the user may have edited it).
    ensure_builtin_file(config_dir)?;

    if needs_persist {
        write_skills_file(&path, &skills)?;
    }
    Ok(skills)
}

/// Validates and persists a whole skill list, returning the persisted list.
///
/// The frontend owns add/delete/edit/reorder and submits the complete list;
/// this rejects invalid aliases, a non-text or directory path, and any attempt
/// to drop the built-in skill. Paths are normalised (trimmed, unquoted) before
/// validation so the value written to disk is the clean one, not the raw paste.
pub fn save(config_dir: &Path, skills: Vec<Skill>) -> Result<Vec<Skill>, SkillError> {
    let skills: Vec<Skill> = skills.into_iter().map(normalize_skill).collect();
    validate(&skills)?;
    ensure_builtin_file(config_dir)?;
    write_skills_file(&config_dir.join(SKILLS_FILE_NAME), &skills)?;
    Ok(skills)
}

/// Returns `skill` with its `path` normalised for storage.
fn normalize_skill(mut skill: Skill) -> Skill {
    skill.path = normalize_skill_path(&skill.path);
    skill
}

/// Writes the built-in assistant skill file if it does not already exist.
fn ensure_builtin_file(config_dir: &Path) -> Result<(), SkillError> {
    let path = config_dir.join(BUILTIN_ASSISTANT_FILE_NAME);
    if path.exists() {
        return Ok(());
    }
    crate::config::atomic_write_bytes(&path, BUILTIN_ASSISTANT_TEXT.as_bytes())
        .map_err(|source| SkillError::IoError { path, source })
}

/// Serializes `skills` to `path` with the atomic writer used by the config
/// store (temp file + rename).
fn write_skills_file(path: &Path, skills: &[Skill]) -> Result<(), SkillError> {
    let file = SkillsFile {
        skills: skills.to_vec(),
    };
    // The shape is simple scalars and strings; serialization cannot fail.
    let text = toml::to_string_pretty(&file).expect("SkillsFile is always serializable to TOML");
    crate::config::atomic_write_bytes(path, text.as_bytes()).map_err(|source| SkillError::IoError {
        path: path.to_path_buf(),
        source,
    })
}

/// A skill whose file could not be read at use time, or a whole-store load
/// failure. The turn still proceeds; the frontend localizes the stable
/// `skill_unreadable` code and shows [`SkillReadFailure::detail`] as the
/// subtitle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillReadFailure {
    /// Empty for a store-level failure (there is no skill to name).
    pub alias: String,
    /// Empty when the failure is an unknown alias or a store-level failure.
    pub path: String,
    pub message: String,
}

impl SkillReadFailure {
    /// A failure that concerns the whole skills store rather than one skill
    /// file — e.g. the store could not be read or the load task panicked.
    pub fn store(message: impl Into<String>) -> Self {
        Self {
            alias: String::new(),
            path: String::new(),
            message: message.into(),
        }
    }

    /// Human-readable detail naming the skill and the reason.
    pub fn detail(&self) -> String {
        if self.alias.is_empty() {
            self.message.clone()
        } else if self.path.is_empty() {
            format!("no skill named \"{}\"", self.alias)
        } else {
            format!(
                "skill \"{}\" ({}) is not readable: {}",
                self.alias, self.path, self.message
            )
        }
    }
}

/// Appends the contents of every enabled skill to `base`, returning the
/// composed text plus any read failures. Empty files contribute nothing; a
/// missing or unreadable file is reported instead of failing the turn.
pub fn append_enabled_skills(base: &str, skills: &[Skill]) -> (String, Vec<SkillReadFailure>) {
    let mut out = base.to_string();
    let mut failures = Vec::new();
    for skill in skills.iter().filter(|s| s.enabled) {
        match read_skill(skill) {
            Ok(Some(text)) => push_block(&mut out, &text),
            Ok(None) => {}
            Err(failure) => failures.push(failure),
        }
    }
    (out, failures)
}

/// Appends the contents of the skills named by `aliases` to `base`, returning
/// the composed text plus any read failures. Unknown aliases and unreadable
/// files are reported rather than failing the turn.
pub fn append_skills_by_alias(
    base: &str,
    skills: &[Skill],
    aliases: &[String],
) -> (String, Vec<SkillReadFailure>) {
    let mut out = base.to_string();
    let mut failures = Vec::new();
    for alias in aliases {
        match skills.iter().find(|s| &s.alias == alias) {
            Some(skill) => match read_skill(skill) {
                Ok(Some(text)) => push_block(&mut out, &text),
                Ok(None) => {}
                Err(failure) => failures.push(failure),
            },
            None => failures.push(SkillReadFailure {
                alias: alias.clone(),
                path: String::new(),
                message: "unknown alias".to_string(),
            }),
        }
    }
    (out, failures)
}

/// Reads a skill's file. Returns `Ok(None)` for a file that is empty or only
/// whitespace (nothing to append), and `Err` with the failure detail otherwise.
fn read_skill(skill: &Skill) -> Result<Option<String>, SkillReadFailure> {
    match std::fs::read_to_string(&skill.path) {
        Ok(text) if text.trim().is_empty() => Ok(None),
        Ok(text) => Ok(Some(text)),
        Err(e) => Err(SkillReadFailure {
            alias: skill.alias.clone(),
            path: skill.path.clone(),
            message: e.to_string(),
        }),
    }
}

/// Appends `text` to `out` as a separate block, trimming trailing whitespace
/// and inserting a blank-line separator only when `out` already has content.
fn push_block(out: &mut String, text: &str) {
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(text.trim_end());
}

// ─── Tauri command surface ──────────────────────────────────────────────────

/// Returns the persisted skill list, seeding the built-in assistant on first use.
#[tauri::command]
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn get_skills(app: tauri::AppHandle) -> Result<Vec<Skill>, SkillError> {
    load(&config_dir(&app)?)
}

/// Validates and persists a whole skill list, returning the persisted list.
#[tauri::command]
#[cfg_attr(coverage_nightly, coverage(off))]
pub fn set_skills(skills: Vec<Skill>, app: tauri::AppHandle) -> Result<Vec<Skill>, SkillError> {
    save(&config_dir(&app)?, skills)
}

/// Resolves the per-user config directory, where `skills.toml` and the
/// built-in assistant file live. Tauri-aware; needs a real `AppHandle`.
#[cfg_attr(coverage_nightly, coverage(off))]
fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, SkillError> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .map_err(|source| SkillError::IoError {
            path: PathBuf::from("<app_config_dir>"),
            source: std::io::Error::other(source.to_string()),
        })
}

/// Loads the skills store for one turn (chat `ask` or an agent run), off the
/// async runtime thread because [`load`] performs blocking file I/O and may
/// seed the store.
///
/// Returns the skill list plus any failure that should be surfaced: a
/// store-level load error becomes a [`SkillReadFailure::store`] so an
/// unreadable store never silently drops the enabled skills from the prompt.
/// A missing config directory yields an empty list and no failure.
#[cfg_attr(coverage_nightly, coverage(off))]
pub async fn load_for_turn(app: &tauri::AppHandle) -> (Vec<Skill>, Vec<SkillReadFailure>) {
    let dir = match config_dir(app) {
        Ok(dir) => dir,
        Err(_) => return (Vec::new(), Vec::new()),
    };
    match tauri::async_runtime::spawn_blocking(move || load(&dir)).await {
        Ok(Ok(skills)) => (skills, Vec::new()),
        Ok(Err(err)) => (Vec::new(), vec![SkillReadFailure::store(err.to_string())]),
        Err(err) => (
            Vec::new(),
            vec![SkillReadFailure::store(format!(
                "skills store task failed: {err}"
            ))],
        ),
    }
}

#[cfg(test)]
mod tests;
