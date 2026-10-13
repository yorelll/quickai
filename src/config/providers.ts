/**
 * Cloud provider metadata shared by the Settings AI/Agent tabs.
 *
 * The wire strings match the Rust `Provider` enum's serde names exactly
 * (`"openai" | "anthropic" | "openai_compatible"`) — see `task/INTERFACE.md`.
 */
import type { TranslationKey } from '../i18n';

/** Selector values accepted by the backend for `[chat]` / `[agent]`. */
export const PROVIDERS = ['openai', 'anthropic', 'openai_compatible'] as const;

export type Provider = (typeof PROVIDERS)[number];

/** Known model names offered as datalist suggestions per provider. */
export const PROVIDER_MODELS: Record<Provider, readonly string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o4-mini', 'gpt-4.1'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  openai_compatible: [],
};

/** Default base URL per provider. `openai_compatible` has none. */
export const PROVIDER_DEFAULT_BASE_URL: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  openai_compatible: '',
};

/** Translation key for a provider's display name. */
const PROVIDER_LABEL_KEYS: Record<Provider, TranslationKey> = {
  openai: 'provider.openai',
  anthropic: 'provider.anthropic',
  openai_compatible: 'provider.openai_compatible',
};

/** Narrows an arbitrary config string to a known provider, defaulting to OpenAI. */
export function normalizeProvider(value: string): Provider {
  return (PROVIDERS as readonly string[]).includes(value)
    ? (value as Provider)
    : 'openai';
}

/** Localized display name for a provider. */
export function providerLabelKey(provider: Provider): TranslationKey {
  return PROVIDER_LABEL_KEYS[provider];
}
