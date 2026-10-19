import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILTIN_SKILL_ID,
  describeSkillError,
  isBuiltinSkill,
  newSkillId,
  parseSkillError,
  validateAlias,
  type Skill,
} from '../skills';
import { setLocale, t } from '../../i18n';

const skill = (over: Partial<Skill>): Skill => ({
  id: 'a',
  alias: 'alpha',
  path: 'C:\\skills\\alpha.md',
  enabled: false,
  ...over,
});

describe('skills', () => {
  beforeEach(() => setLocale('en'));

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

  describe('parseSkillError', () => {
    it('parses each kind the backend emits', () => {
      for (const kind of [
        'empty_alias',
        'alias_has_whitespace',
        'duplicate_alias',
        'builtin_not_deletable',
        'empty_path',
        'path_not_a_file',
        'stray_quote',
        'io_error',
      ]) {
        expect(parseSkillError({ kind })).toEqual({ kind, extension: '' });
      }
    });

    it('carries the offending extension for an unsupported format', () => {
      expect(
        parseSkillError({ kind: 'unsupported_format', extension: 'pdf' }),
      ).toEqual({ kind: 'unsupported_format', extension: 'pdf' });
    });

    it('ignores a non-string extension', () => {
      expect(
        parseSkillError({ kind: 'unsupported_format', extension: 7 }),
      ).toEqual({ kind: 'unsupported_format', extension: '' });
    });

    it('rejects a value that is not an object, a null, or an unknown kind', () => {
      expect(parseSkillError('disk full')).toBeNull();
      expect(parseSkillError(null)).toBeNull();
      expect(parseSkillError({ kind: 'meltdown' })).toBeNull();
      expect(parseSkillError({})).toBeNull();
    });
  });

  describe('describeSkillError', () => {
    it('names the offending extension for an unsupported format', () => {
      expect(
        describeSkillError({ kind: 'unsupported_format', extension: 'pdf' }, t),
      ).toBe(
        'Unsupported file type (.pdf). Only .txt and .md files are allowed.',
      );
    });

    it('uses extension-free copy when the file has none', () => {
      expect(
        describeSkillError({ kind: 'unsupported_format', extension: '' }, t),
      ).toBe('Only .txt and .md skill files are allowed.');
    });

    it('localizes every other kind', () => {
      expect(describeSkillError({ kind: 'empty_path', extension: '' }, t)).toBe(
        'Enter a path for this skill.',
      );
      expect(
        describeSkillError({ kind: 'path_not_a_file', extension: '' }, t),
      ).toBe('That path is a folder. Choose a file, not a folder.');
      expect(
        describeSkillError({ kind: 'stray_quote', extension: '' }, t),
      ).toBe('The path still starts or ends with a quote character.');
      expect(
        describeSkillError({ kind: 'builtin_not_deletable', extension: '' }, t),
      ).toBe('The built-in skill cannot be deleted.');
      expect(describeSkillError({ kind: 'io_error', extension: '' }, t)).toBe(
        "Couldn't save skills. Please try again.",
      );
    });
  });
});
