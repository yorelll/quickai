/**
 * Alias validation and built-in detection for the Settings Skills editor.
 *
 * The backend owns storage (`skills.toml`) and re-validates on save; the
 * frontend mirrors the alias rules so a bad edit is rejected before the
 * round-trip.
 */

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
