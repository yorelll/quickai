import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  PROVIDER_MODELS,
  PROVIDER_DEFAULT_BASE_URL,
  normalizeProvider,
  providerLabelKey,
} from '../providers';
import { en } from '../../i18n/en';
import { zh } from '../../i18n/zh';

describe('providers', () => {
  it('uses exactly the wire strings frozen in INTERFACE.md', () => {
    expect(PROVIDERS).toEqual(['openai', 'anthropic', 'openai_compatible']);
  });

  it('defines a model list for every provider', () => {
    for (const provider of PROVIDERS) {
      expect(Array.isArray(PROVIDER_MODELS[provider])).toBe(true);
    }
    expect(PROVIDER_MODELS.openai).toContain('gpt-4o');
    expect(PROVIDER_MODELS.anthropic).toContain('claude-sonnet-4-5');
    expect(PROVIDER_MODELS.openai_compatible).toEqual([]);
  });

  it('defines default base URLs, with none for custom providers', () => {
    expect(PROVIDER_DEFAULT_BASE_URL.openai).toBe('https://api.openai.com/v1');
    expect(PROVIDER_DEFAULT_BASE_URL.anthropic).toBe(
      'https://api.anthropic.com',
    );
    expect(PROVIDER_DEFAULT_BASE_URL.openai_compatible).toBe('');
  });

  it('normalizes known providers untouched', () => {
    for (const provider of PROVIDERS) {
      expect(normalizeProvider(provider)).toBe(provider);
    }
  });

  it('falls back to OpenAI for unknown provider strings', () => {
    expect(normalizeProvider('foobar')).toBe('openai');
    expect(normalizeProvider('')).toBe('openai');
  });

  it('maps every provider to a localized label', () => {
    for (const provider of PROVIDERS) {
      const key = providerLabelKey(provider);
      expect(en[key]).toBeTruthy();
      expect(zh[key]).toBeTruthy();
    }
  });
});
