import { describe, it, expect } from 'vitest';
import { describeConfigError } from '../types';
import { translate, type Translate } from '../../i18n';
import { en } from '../../i18n/en';

const t: Translate = (key, params) => translate('en', key, params);

describe('describeConfigError', () => {
  it('returns the generic message for non-object errors', () => {
    expect(describeConfigError('boom', t)).toBe(en['configError.generic']);
    expect(describeConfigError(null, t)).toBe(en['configError.generic']);
  });

  it('describes io errors with their source', () => {
    expect(
      describeConfigError({ kind: 'io_error', source: 'disk full' }, t),
    ).toBe("Couldn't save: disk full.");
  });

  it('falls back to a generic io source when omitted', () => {
    expect(describeConfigError({ kind: 'io_error' }, t)).toBe(
      "Couldn't save: I/O error.",
    );
  });

  it('describes unknown sections', () => {
    expect(
      describeConfigError({ kind: 'unknown_section', section: 'chat' }, t),
    ).toBe('Unknown section: chat.');
    expect(describeConfigError({ kind: 'unknown_section' }, t)).toBe(
      'Unknown section: .',
    );
  });

  it('describes unknown fields', () => {
    expect(
      describeConfigError(
        { kind: 'unknown_field', section: 'chat', key: 'model' },
        t,
      ),
    ).toBe('Unknown field: chat.model.');
    expect(describeConfigError({ kind: 'unknown_field' }, t)).toBe(
      'Unknown field: ..',
    );
  });

  it('describes type mismatches, preferring the backend message', () => {
    expect(
      describeConfigError(
        { kind: 'type_mismatch', message: 'expected integer' },
        t,
      ),
    ).toBe('expected integer');
    expect(describeConfigError({ kind: 'type_mismatch' }, t)).toBe(
      en['configError.typeMismatch'],
    );
  });

  it('describes parse failures', () => {
    expect(describeConfigError({ kind: 'parse' }, t)).toBe(
      en['configError.parse'],
    );
  });

  it('describes seed failures with their source', () => {
    expect(
      describeConfigError({ kind: 'seed_failed', source: 'read-only' }, t),
    ).toBe("Couldn't write defaults: read-only.");
    expect(describeConfigError({ kind: 'seed_failed' }, t)).toBe(
      "Couldn't write defaults: .",
    );
  });

  it('falls back to a raw message for unknown kinds', () => {
    expect(describeConfigError({ kind: 'mystery', message: 'huh' }, t)).toBe(
      'huh',
    );
    expect(describeConfigError({ kind: 'mystery' }, t)).toBe(
      en['configError.generic'],
    );
  });
});
