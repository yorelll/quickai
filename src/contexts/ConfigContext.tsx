/**
 * Application configuration context.
 *
 * Hydrates once from the Rust-side `get_config` Tauri command on mount, then
 * provides a synchronous `useConfig` hook to every descendant. Render is
 * gated until the first fetch resolves so components never see a null
 * config: this eliminates the per-call-site fallback literals that the
 * backend migration is specifically trying to kill.
 *
 * The Rust `AppConfig` serializes with snake_case field names (matching the
 * on-disk TOML schema). We translate to camelCase here so React components
 * keep their idiomatic JS names. The API keys are NOT in this config: they
 * live in the SQLite `app_config` table and are read through `get_settings`.
 */

import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Backend event broadcast after the in-memory `AppConfig` is replaced
 * (`set_config_field`, `reset_config`, `reload_config_from_disk`). Mirrors
 * the Rust-side `CONFIG_UPDATED_EVENT` constant in `settings_commands.rs`.
 * Kept as a string literal here to avoid pulling a Rust-codegen dep into
 * the frontend.
 */
const CONFIG_UPDATED_EVENT = 'quickai://config-updated';

/** Shape returned by the Rust `get_config` command (snake_case). */
interface RawAppConfig {
  general: {
    hotkey: string;
    language: string;
    data_dir: string;
  };
  prompt: {
    system: string;
  };
  window: {
    overlay_width: number;
    max_chat_height: number;
    max_images: number;
  };
  quote: {
    max_display_lines: number;
    max_display_chars: number;
    max_context_length: number;
  };
  chat: {
    provider: string;
    model: string;
    base_url: string;
  };
  agent: {
    mode: string;
    provider: string;
    model: string;
    base_url: string;
    permission: string;
  };
}

/** Camel-cased, frontend-friendly view of the configuration. */
export interface AppConfig {
  general: {
    hotkey: string;
    language: string;
    dataDir: string;
  };
  prompt: {
    /** Raw user-editable persona prompt (may be empty). */
    system: string;
  };
  window: {
    overlayWidth: number;
    maxChatHeight: number;
    maxImages: number;
  };
  quote: {
    maxDisplayLines: number;
    maxDisplayChars: number;
    maxContextLength: number;
  };
  chat: {
    provider: string;
    model: string;
    baseUrl: string;
  };
  agent: {
    mode: string;
    provider: string;
    model: string;
    baseUrl: string;
    permission: string;
  };
}

function transform(raw: RawAppConfig): AppConfig {
  return {
    general: {
      hotkey: raw.general.hotkey,
      language: raw.general.language,
      dataDir: raw.general.data_dir,
    },
    prompt: {
      system: raw.prompt.system,
    },
    window: {
      overlayWidth: raw.window.overlay_width,
      maxChatHeight: raw.window.max_chat_height,
      maxImages: raw.window.max_images,
    },
    quote: {
      maxDisplayLines: raw.quote.max_display_lines,
      maxDisplayChars: raw.quote.max_display_chars,
      maxContextLength: raw.quote.max_context_length,
    },
    chat: {
      provider: raw.chat.provider,
      model: raw.chat.model,
      baseUrl: raw.chat.base_url,
    },
    agent: {
      mode: raw.agent.mode,
      provider: raw.agent.provider,
      model: raw.agent.model,
      baseUrl: raw.agent.base_url,
      permission: raw.agent.permission,
    },
  };
}

const ConfigContext = createContext<AppConfig | null>(null);

/**
 * Renders children only once `get_config` resolves. Blocks with `null`
 * (no visible splash) for the tiny IPC round-trip; Tauri local IPC is
 * sub-10ms in practice.
 */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * Fetches `get_config` and pushes the transformed value into state. Used
     * for initial hydrate and for every `CONFIG_UPDATED_EVENT` refresh after
     * the Settings window writes a change. The post-mount path tolerates
     * the same nullish/error fallbacks as initial mount: a transient IPC
     * failure should not flip the tree back to DEFAULT_CONFIG and lose any
     * good values already in place.
     */
    const refresh = (initial: boolean) => {
      void invoke<RawAppConfig>('get_config')
        .then((raw) => {
          if (cancelled) return;
          if (raw == null) {
            if (initial) setConfig(DEFAULT_CONFIG);
            return;
          }
          setConfig(transform(raw));
        })
        .catch(() => {
          if (cancelled) return;
          if (initial) setConfig(DEFAULT_CONFIG);
        });
    };

    refresh(true);

    let unlisten: UnlistenFn | undefined;
    void listen<unknown>(CONFIG_UPDATED_EVENT, () => {
      refresh(false);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // Event bridge unavailable (test env, Tauri not ready). Initial
        // hydrate still happened above; subscribers fall back to a static
        // snapshot and pick up edits on next mount.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!config) return null;

  return <ConfigContext value={config}>{children}</ConfigContext>;
}

/**
 * Returns the current resolved `AppConfig`.
 *
 * When no `ConfigProvider` wraps the calling component, falls back to
 * `DEFAULT_CONFIG`. In production `main.tsx` always wraps `<App />`, so this
 * path only fires from component tests that render a leaf without setting up
 * a provider. Keeps test infrastructure minimal without compromising the
 * production single-source-of-truth guarantee.
 *
 * If test-side defaults ever drift from the Rust-side `AppConfig::default()`,
 * the fix is to update `DEFAULT_CONFIG` below. The two shapes are kept in
 * sync by hand because cross-language codegen is not worth the dependency
 * in a Windows-only desktop app.
 */
export function useConfig(): AppConfig {
  const value = use(ConfigContext);
  return value ?? DEFAULT_CONFIG;
}

/**
 * Test helper: wraps children with a synchronous (no `invoke`) ConfigContext
 * populated from `value`. Useful when a test needs to assert behavior against
 * a non-default config.
 */
export function ConfigProviderForTest({
  value,
  children,
}: {
  value: AppConfig;
  children: ReactNode;
}) {
  return <ConfigContext value={value}>{children}</ConfigContext>;
}

/**
 * Default AppConfig used when no `ConfigProvider` wraps the caller. Values
 * mirror the Rust-side `AppConfig::default()` (see
 * `src-tauri/src/config/defaults.rs`).
 */
export const DEFAULT_CONFIG: AppConfig = {
  general: {
    hotkey: 'ctrl',
    language: 'auto',
    dataDir: '',
  },
  prompt: { system: '' },
  window: {
    overlayWidth: 600,
    maxChatHeight: 648,
    maxImages: 3,
  },
  quote: {
    maxDisplayLines: 4,
    maxDisplayChars: 300,
    maxContextLength: 4096,
  },
  chat: {
    provider: 'openai',
    model: '',
    baseUrl: '',
  },
  agent: {
    mode: 'same_as_chat',
    provider: 'openai',
    model: '',
    baseUrl: '',
    permission: 'limited',
  },
};
