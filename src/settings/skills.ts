/**
 * Alias validation, built-in detection, and backend-error localisation for the
 * Settings Skills editor.
 *
 * The backend owns storage (`skills.toml`) and re-validates on save; the
 * frontend mirrors the alias rules so a bad edit is rejected before the
 * round-trip, and localises the backend's typed rejections (a bad path, an
 * unsupported format) so they never render blank.
 */

import type { Translate, TranslationKey } from '../i18n';
import type { Skill } from '../types/skill';

export type { Skill };

/** Id of the seeded built-in assistant skill, which cannot be deleted. */
export const BUILTIN_SKILL_ID = 'builtin-assistant';

/** True when the skill is the built-in assistant. */
export function isBuiltinSkill(skill: Skill): boolean {
  return skill.id === BUILTIN_SKILL_ID;
}

/** Why a candidate alias was rejected. */
export type AliasError = 'empty' | 'whitespace' | 'duplicate';

/**
 * Validates a candidate alias against the other skills. `ignoreId` excludes
 * the entry being edited so renaming a skill to its own alias is allowed.
 * Returns the failure kind, or null when the alias is acceptable.
 */
export function validateAlias(
  alias: string,
  skills: readonly Skill[],
  ignoreId: string | null,
): AliasError | null {
  if (alias.trim().length === 0) return 'empty';
  if (/\s/.test(alias)) return 'whitespace';
  const normalized = alias.toLowerCase();
  const clash = skills.some(
    (skill) =>
      skill.id !== ignoreId && skill.alias.toLowerCase() === normalized,
  );
  return clash ? 'duplicate' : null;
}

/** Mints a stable id for a newly added skill. */
export function newSkillId(): string {
  return crypto.randomUUID();
}

// ─── Backend rejections (`set_skills` → SkillError) ─────────────────────────

/**
 * The stable `kind` values the Rust `SkillError` serializes. Kept in lock-step
 * with `src-tauri/src/skills.rs`; every one has a copy key below, so a
 * rejection the user can cause never renders blank.
 */
export type SkillErrorKind =
  | 'empty_alias'
  | 'alias_has_whitespace'
  | 'duplicate_alias'
  | 'builtin_not_deletable'
  | 'empty_path'
  | 'path_not_a_file'
  | 'stray_quote'
  | 'unsupported_format'
  | 'io_error';

/** Copy key for each backend rejection kind. */
const SKILL_ERROR_KEYS: Record<SkillErrorKind, TranslationKey> = {
  empty_alias: 'settings.skills.errorAliasEmpty',
  alias_has_whitespace: 'settings.skills.errorAliasWhitespace',
  duplicate_alias: 'settings.skills.errorAliasDuplicate',
  builtin_not_deletable: 'settings.skills.errorBuiltinNotDeletable',
  empty_path: 'settings.skills.errorPathEmpty',
  path_not_a_file: 'settings.skills.errorPathNotAFile',
  stray_quote: 'settings.skills.errorStrayQuote',
  unsupported_format: 'settings.skills.errorUnsupportedFormat',
  io_error: 'settings.skills.saveError',
};

/** A parsed `set_skills` rejection. */
export interface SkillSaveError {
  kind: SkillErrorKind;
  /** The offending extension, lowercased, for `unsupported_format`; else ''. */
  extension: string;
}

/** Whether `value` is one of the kinds this build knows how to localise. */
function isSkillErrorKind(value: unknown): value is SkillErrorKind {
  return typeof value === 'string' && value in SKILL_ERROR_KEYS;
}

/**
 * Narrows a `set_skills` rejection to a typed [`SkillSaveError`], or null when
 * it is not a shape this build recognises (a transport failure, a panic).
 */
export function parseSkillError(err: unknown): SkillSaveError | null {
  if (typeof err !== 'object' || err === null) return null;
  const { kind, extension } = err as { kind?: unknown; extension?: unknown };
  if (!isSkillErrorKind(kind)) return null;
  return { kind, extension: typeof extension === 'string' ? extension : '' };
}

/**
 * Localizes a parsed skills rejection. An `unsupported_format` with no
 * extension (a file the OS reports no suffix for) gets its own copy rather
 * than an empty placeholder.
 */
export function describeSkillError(err: SkillSaveError, t: Translate): string {
  if (err.kind !== 'unsupported_format') {
    return t(SKILL_ERROR_KEYS[err.kind]);
  }
  return err.extension
    ? t('settings.skills.errorUnsupportedFormat', {
        extension: `.${err.extension}`,
      })
    : t('settings.skills.errorUnsupportedFormatNoExt');
}
