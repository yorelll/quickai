/**
 * General tab - summon hotkey, interface language, theme, data directory, and
 * the Windows start-on-boot toggle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import {
  Section,
  SettingRow,
  Dropdown,
  TextField,
  Toggle,
  ErrorDialog,
} from '../components';
import { SaveField } from '../components/SaveField';
import { configHelp } from '../configHelpers';
import { HOTKEYS, normalizeHotkey, hotkeyLabelKey } from '../hotkeys';
import { THEMES, applyTheme, normalizeTheme, themeLabelKey } from '../theme';
import {
  useTranslation,
  getLanguageSetting,
  setLanguageSetting,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGE_SETTINGS,
  type LanguageSetting,
  type TranslationKey,
} from '../../i18n';
import styles from '../../styles/settings.module.css';
import type { RawAppConfig } from '../types';

const LANGUAGE_LABEL_KEYS: Record<LanguageSetting, TranslationKey> = {
  auto: 'language.auto',
  en: 'language.en',
  zh: 'language.zh',
};

/** Narrows an arbitrary config string to a known setting, defaulting to auto. */
function normalizeLanguage(value: string): LanguageSetting {
  return (SUPPORTED_LANGUAGE_SETTINGS as readonly string[]).includes(value)
    ? (value as LanguageSetting)
    : 'auto';
}

/**
 * The language actually in effect. `setLanguageSetting` writes an explicit
 * choice to localStorage synchronously, so that is the authoritative source
 * for what the interface is showing; `config.general.language` is the
 * persisted mirror and only catches up once the write lands. An absent entry
 * means "follow the system", which defers to whatever the config pins.
 */
function effectiveLanguage(configured: LanguageSetting): LanguageSetting {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === null ? configured : normalizeLanguage(stored);
}

interface GeneralTabProps {
  config: RawAppConfig;
  resyncToken: number;
  onSaved: (next: RawAppConfig) => void;
}

export function GeneralTab({ config, resyncToken, onSaved }: GeneralTabProps) {
  const { t } = useTranslation();
  /** null until the OS reports whether a startup task is registered. */
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  const [autoStartError, setAutoStartError] = useState(false);
  /** Resolved OS default data directory, shown when the field is empty. */
  const [defaultDataDir, setDefaultDataDir] = useState('');

  const configuredLanguage = normalizeLanguage(config.general.language);

  // Adopt the language pinned in config.toml once, on mount, so a hand-edited
  // config applies on the next open. Only when nothing is persisted: an
  // explicit choice the user already made must never be clobbered (a failed
  // save leaves config at `auto`, and reverting here would silently discard
  // the selection). `auto` means "follow the system", which needs no action.
  const initialLanguageRef = useRef(configuredLanguage);
  useEffect(() => {
    const pinned = initialLanguageRef.current;
    if (pinned !== 'auto' && getLanguageSetting() === 'auto') {
      setLanguageSetting(pinned);
    }
  }, []);

  // The resolved default is the value an empty data_dir falls back to; the
  // field shows it as its placeholder so the user never has to guess.
  useEffect(() => {
    let cancelled = false;
    void invoke<string>('get_default_data_dir')
      .then((path) => {
        if (!cancelled) setDefaultDataDir(path);
      })
      .catch(() => {
        // Command unavailable: keep the generic placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Start-on-boot is an OS registration (Task Scheduler), not a config field,
  // so it is read and written through its own commands.
  useEffect(() => {
    let cancelled = false;
    void invoke<boolean>('is_auto_start_enabled_command')
      .then((enabled) => {
        if (!cancelled) setAutoStart(enabled);
      })
      .catch(() => {
        if (!cancelled) setAutoStart(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAutoStartToggle = useCallback(async (next: boolean) => {
    setAutoStartError(false);
    try {
      await invoke(
        next ? 'enable_auto_start_command' : 'disable_auto_start_command',
      );
      setAutoStart(next);
    } catch {
      // Leave the switch where it was and tell the user the change failed.
      setAutoStartError(true);
    }
  }, []);

  const handleBrowse = useCallback(async (setValue: (next: string) => void) => {
    try {
      const picked = await invoke<string | null>('pick_folder');
      if (picked) setValue(picked);
    } catch {
      // Picker unavailable: leave the field untouched.
    }
  }, []);

  return (
    <>
      <Section heading={t('settings.section.hotkey')}>
        <SaveField
          section="general"
          fieldKey="hotkey"
          label={t('settings.general.hotkey')}
          helper={t(configHelp('general', 'hotkey'))}
          initialValue={config.general.hotkey}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <Dropdown
              value={normalizeHotkey(value)}
              options={HOTKEYS}
              onChange={setValue}
              formatOption={(key) =>
                t('hotkey.doubleTap', { key: t(hotkeyLabelKey(key)) })
              }
              ariaLabel={t('settings.general.hotkey')}
            />
          )}
        />
      </Section>

      <Section heading={t('settings.section.language')}>
        <SaveField
          section="general"
          fieldKey="language"
          label={t('settings.general.language')}
          helper={t(configHelp('general', 'language'))}
          initialValue={config.general.language}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(_value, setValue) => (
            <Dropdown
              value={effectiveLanguage(configuredLanguage)}
              options={SUPPORTED_LANGUAGE_SETTINGS}
              onChange={(next) => {
                setValue(next);
                setLanguageSetting(next);
              }}
              formatOption={(setting) => t(LANGUAGE_LABEL_KEYS[setting])}
              ariaLabel={t('settings.general.language')}
            />
          )}
        />
      </Section>

      <Section heading={t('settings.section.appearance')}>
        <SaveField
          section="general"
          fieldKey="theme"
          label={t('settings.general.theme')}
          helper={t(configHelp('general', 'theme'))}
          initialValue={config.general.theme}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <Dropdown
              value={normalizeTheme(value)}
              options={THEMES}
              onChange={(next) => {
                setValue(next);
                applyTheme(next);
              }}
              formatOption={(theme) => t(themeLabelKey(theme))}
              ariaLabel={t('settings.general.theme')}
            />
          )}
        />
      </Section>

      <Section heading={t('settings.section.data')}>
        <SaveField
          section="general"
          fieldKey="data_dir"
          label={t('settings.general.dataDir')}
          helper={t(configHelp('general', 'data_dir'))}
          initialValue={config.general.data_dir}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue, errored) => (
            <div className={styles.fieldWithButton}>
              <TextField
                value={value}
                onChange={setValue}
                placeholder={
                  defaultDataDir || t('settings.general.dataDirPlaceholder')
                }
                errored={errored}
                ariaLabel={t('settings.general.dataDir')}
              />
              <button
                type="button"
                className={`${styles.button} ${styles.buttonGhost}`}
                onClick={() => void handleBrowse(setValue)}
              >
                {t('settings.general.dataDirBrowse')}
              </button>
            </div>
          )}
        />
        {defaultDataDir ? (
          <p className={styles.rowHelper}>
            {t('settings.general.dataDirDefault', { path: defaultDataDir })}
          </p>
        ) : null}
        <p className={styles.rowHelper}>{t('settings.general.dataDirNote')}</p>
      </Section>

      <Section heading={t('settings.section.startup')}>
        <SettingRow label={t('settings.general.startOnBoot')}>
          <Toggle
            checked={autoStart === true}
            onChange={(next) => void handleAutoStartToggle(next)}
            ariaLabel={t('settings.general.startOnBoot')}
          />
        </SettingRow>
        {autoStartError ? (
          <ErrorDialog
            open
            title={t('settings.general.startOnBootErrorTitle')}
            message={t('settings.general.startOnBootError')}
            onClose={() => setAutoStartError(false)}
          />
        ) : null}
      </Section>
    </>
  );
}
