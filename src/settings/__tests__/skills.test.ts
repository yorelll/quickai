import { describe, it, expect } from 'vitest';
import {
  BUILTIN_SKILL_ID,
  isBuiltinSkill,
  newSkillId,
  validateAlias,
  type Skill,
} from '../skills';

const skill = (over: Partial<Skill>): Skill => ({
  id: 'a',
  alias: 'alpha',
  path: 'C:\\skills\\alpha.md',
  enabled: false,
  ...over,
});

describe('skills', () => {
  it('recognises the built-in assistant skill', () => {
    expect(isBuiltinSkill(skill({ id: BUILTIN_SKILL_ID }))).toBe(true);
    expect(isBuiltinSkill(skill({}))).toBe(false);
  });

  it('mints a non-empty id for a new skill', () => {
    expect(newSkillId()).not.toBe('');
  });

  describe('validateAlias', () => {
    const list = [
      skill({ id: 'a', alias: 'alpha' }),
      skill({ id: 'b', alias: 'Beta' }),
    ];

    it('accepts a fresh, whitespace-free alias', () => {
      expect(validateAlias('gamma', list, null)).toBeNull();
    });

    it('rejects an empty or blank alias', () => {
      expect(validateAlias('', list, null)).toBe('empty');
      expect(validateAlias('   ', list, null)).toBe('empty');
    });

    it('rejects whitespace anywhere in the alias', () => {
      expect(validateAlias('two words', list, null)).toBe('whitespace');
      expect(validateAlias('trailing ', list, null)).toBe('whitespace');
    });

    it('rejects a duplicate alias, ignoring case', () => {
      expect(validateAlias('beta', list, null)).toBe('duplicate');
      expect(validateAlias('ALPHA', list, null)).toBe('duplicate');
    });

    it('lets a skill keep its own alias', () => {
      expect(validateAlias('alpha', list, 'a')).toBeNull();
      expect(validateAlias('ALPHA', list, 'a')).toBeNull();
    });
  });
});
