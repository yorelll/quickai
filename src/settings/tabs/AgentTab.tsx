/**
 * Agent tab - configuration source (same as AI / custom) and permissions for
 * /do agent mode. The provider, model, base URL and API key are only shown in
 * custom mode; otherwise the agent reuses the chat configuration.
 */

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { Section, SettingRow, TextField, Dropdown } from '../components';
import { SaveField } from '../components/SaveField';
import { configHelp } from '../configHelpers';
import { useTranslation, type TranslationKey } from '../../i18n';
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

const MODES = ['same_as_chat', 'custom'] as const;
type AgentMode = (typeof MODES)[number];

const PERMISSIONS = ['limited', 'full'] as const;
type AgentPermission = (typeof PERMISSIONS)[number];

const MODE_LABEL_KEYS: Record<AgentMode, TranslationKey> = {
  same_as_chat: 'agent.mode.sameAsChat',
  custom: 'agent.mode.custom',
};

const PERMISSION_LABEL_KEYS: Record<AgentPermission, TranslationKey> = {
  limited: 'agent.permission.limited',
  full: 'agent.permission.full',
};

function normalizeMode(value: string): AgentMode {
  return value === 'custom' ? 'custom' : 'same_as_chat';
}

function normalizePermission(value: string): AgentPermission {
  return value === 'full' ? 'full' : 'limited';
}

interface AgentTabProps {
  config: RawAppConfig;
  resyncToken: number;
  onSaved: (next: RawAppConfig) => void;
}

export function AgentTab({ config, resyncToken, onSaved }: AgentTabProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const mode = normalizeMode(config.agent.mode);
  const provider = normalizeProvider(config.agent.provider);

  // In custom mode the agent has its own key, stored in SQLite (never in
  // config.toml); in same-as-chat mode it reuses the chat provider's key.
  useEffect(() => {
    if (mode !== 'custom') return;
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
  }, [mode, provider]);

  async function saveApiKey(key: string) {
    try {
      await invoke('set_setting', { key: `api_key_${provider}`, value: key });
    } catch {
      // ignore
    }
  }

  const chatProvider = normalizeProvider(config.chat.provider);
  const chatModel = config.chat.model.trim();

  return (
    <>
      <Section heading={t('settings.section.agentMode')}>
        <SaveField
          section="agent"
          fieldKey="mode"
          label={t('settings.agent.mode')}
          helper={t(configHelp('agent', 'mode'))}
          initialValue={config.agent.mode}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <Dropdown
              value={normalizeMode(value)}
              options={MODES}
              onChange={setValue}
              formatOption={(m) => t(MODE_LABEL_KEYS[m])}
              ariaLabel={t('settings.agent.mode')}
            />
          )}
        />
        {mode === 'same_as_chat' ? (
          <SettingRow label={t('settings.agent.usesChat')}>
            <span className={styles.rowHelper}>
              {t(providerLabelKey(chatProvider))}
              {' · '}
              {chatModel || t('settings.agent.noModel')}
            </span>
          </SettingRow>
        ) : null}
      </Section>

      {mode === 'custom' ? (
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
                <span className={styles.rowHelper}>
                  {t('settings.ai.apiKeyHelper')}
                </span>
              </div>
            </div>
          </Section>
        </>
      ) : null}

      <Section heading={t('settings.section.permissions')}>
        <SaveField
          section="agent"
          fieldKey="permission"
          label={t('settings.agent.permission')}
          helper={t(configHelp('agent', 'permission'))}
          initialValue={config.agent.permission}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <>
              <Dropdown
                value={normalizePermission(value)}
                options={PERMISSIONS}
                onChange={setValue}
                formatOption={(p) => t(PERMISSION_LABEL_KEYS[p])}
                ariaLabel={t('settings.agent.permission')}
              />
              {normalizePermission(value) === 'full' ? (
                <p className={styles.rowError} role="alert">
                  {t('settings.agent.permissionWarning')}
                </p>
              ) : null}
            </>
          )}
        />
      </Section>
    </>
  );
}
