/**
 * Agent tab - provider, model, base URL and API key for /do agent mode.
 */

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { Section, TextField, Dropdown } from '../components';
import { SaveField } from '../components/SaveField';
import { configHelp } from '../configHelpers';
import { useTranslation } from '../../i18n';
import {
  PROVIDERS,
  PROVIDER_MODELS,
  PROVIDER_DEFAULT_BASE_URL,
  normalizeProvider,
  providerLabelKey,
} from '../../config/providers';
import styles from '../../styles/settings.module.css';
import type { RawAppConfig } from '../types';

const MODEL_LIST_ID = 'agent-model-options';

interface AgentTabProps {
  config: RawAppConfig;
  resyncToken: number;
  onSaved: (next: RawAppConfig) => void;
}

export function AgentTab({ config, resyncToken, onSaved }: AgentTabProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const provider = normalizeProvider(config.agent.provider);

  // Load the provider's API key from SQLite (never stored in config.toml).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await invoke<Record<string, string>>('get_settings');
        if (!cancelled) setApiKey(settings[`api_key_${provider}`] ?? '');
      } catch {
        // Key not set yet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  async function saveApiKey(key: string) {
    try {
      await invoke('set_setting', { key: `api_key_${provider}`, value: key });
    } catch {
      // ignore
    }
  }

  return (
    <>
      <Section heading={t('settings.section.provider')}>
        <SaveField
          section="agent"
          fieldKey="provider"
          label={t('settings.agent.provider')}
          helper={t(configHelp('agent', 'provider'))}
          initialValue={config.agent.provider}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <Dropdown
              value={normalizeProvider(value)}
              options={PROVIDERS}
              onChange={setValue}
              ariaLabel={t('settings.agent.provider')}
              formatOption={(p) => t(providerLabelKey(p))}
            />
          )}
        />
      </Section>

      <Section heading={t('settings.section.model')}>
        <SaveField
          section="agent"
          fieldKey="model"
          label={t('settings.agent.model')}
          helper={t(configHelp('agent', 'model'))}
          initialValue={config.agent.model}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue, errored) => (
            <>
              <TextField
                value={value}
                onChange={setValue}
                list={MODEL_LIST_ID}
                placeholder={t('settings.agent.modelPlaceholder')}
                errored={errored}
                ariaLabel={t('settings.agent.model')}
              />
              <datalist id={MODEL_LIST_ID}>
                {PROVIDER_MODELS[provider].map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </>
          )}
        />
      </Section>

      <Section heading={t('settings.section.connection')}>
        <SaveField
          section="agent"
          fieldKey="base_url"
          label={t('settings.ai.baseUrl')}
          helper={t(configHelp('agent', 'base_url'))}
          initialValue={config.agent.base_url}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue, errored) => (
            <TextField
              value={value}
              onChange={setValue}
              placeholder={PROVIDER_DEFAULT_BASE_URL[provider]}
              errored={errored}
              ariaLabel={t('settings.ai.baseUrl')}
            />
          )}
        />
      </Section>

      <Section heading={t('settings.section.apiKey')}>
        <div className={styles.row}>
          <div className={styles.rowLabelGroup}>
            <span className={styles.rowLabel}>
              {t('settings.ai.apiKey', {
                provider: t(providerLabelKey(provider)),
              })}
            </span>
          </div>
          <div className={styles.rowControl}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => saveApiKey(apiKey)}
              placeholder={t('settings.ai.apiKeyPlaceholder')}
              aria-label={t('settings.ai.apiKey', {
                provider: t(providerLabelKey(provider)),
              })}
              className={styles.input}
            />
            <span
              style={{
                fontSize: 11,
                color: 'var(--color-text-secondary)',
              }}
            >
              {t('settings.ai.apiKeyHelper')}
            </span>
          </div>
        </div>
      </Section>
    </>
  );
}
