/**
 * Display tab - window dimensions, quoted-text preview limits, the
 * interface language switcher, and the Windows start-on-boot toggle.
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import {
  Section,
  NumberSlider,
  NumberStepper,
  Dropdown,
  SettingRow,
  Toggle,
} from '../components';
import { SaveField } from '../components/SaveField';
import { configHelp } from '../configHelpers';
import { useTranslation, SUPPORTED_LOCALES, type Locale } from '../../i18n';
import type { RawAppConfig } from '../types';

interface DisplayTabProps {
  config: RawAppConfig;
  resyncToken: number;
  onSaved: (next: RawAppConfig) => void;
}

export function DisplayTab({ config, resyncToken, onSaved }: DisplayTabProps) {
  const { locale, setLocale, t } = useTranslation();
  /** null until the OS reports whether a startup task is registered. */
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  const [autoStartError, setAutoStartError] = useState(false);

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

  const languageLabel = (value: Locale) =>
    t(value === 'zh' ? 'language.zh' : 'language.en');

  return (
    <>
      <Section heading={t('settings.section.window')}>
        <SaveField
          section="window"
          fieldKey="overlay_width"
          label={t('settings.display.overlayWidth')}
          helper={t(configHelp('window', 'overlay_width'))}
          initialValue={config.window.overlay_width}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <NumberSlider
              value={value}
              min={200}
              max={2000}
              step={10}
              unit="px"
              onChange={setValue}
              ariaLabel={t('settings.display.overlayWidth')}
            />
          )}
        />
        <SaveField
          section="window"
          fieldKey="max_chat_height"
          label={t('settings.display.maxChatHeight')}
          helper={t(configHelp('window', 'max_chat_height'))}
          initialValue={config.window.max_chat_height}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <NumberSlider
              value={value}
              min={200}
              max={2000}
              step={10}
              unit="px"
              onChange={setValue}
              ariaLabel={t('settings.display.maxChatHeight')}
            />
          )}
        />
      </Section>

      <Section heading={t('settings.section.input')}>
        <SaveField
          section="window"
          fieldKey="max_images"
          label={t('settings.display.maxImages')}
          helper={t(configHelp('window', 'max_images'))}
          initialValue={config.window.max_images}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <NumberStepper
              value={value}
              min={1}
              max={20}
              onChange={setValue}
              ariaLabel={t('settings.display.maxImages')}
            />
          )}
        />
        <SaveField
          section="quote"
          fieldKey="max_display_lines"
          label={t('settings.display.maxDisplayLines')}
          helper={t(configHelp('quote', 'max_display_lines'))}
          initialValue={config.quote.max_display_lines}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <NumberStepper
              value={value}
              min={1}
              max={100}
              onChange={setValue}
              ariaLabel={t('settings.display.maxDisplayLines')}
            />
          )}
        />
        <SaveField
          section="quote"
          fieldKey="max_display_chars"
          label={t('settings.display.maxDisplayChars')}
          helper={t(configHelp('quote', 'max_display_chars'))}
          initialValue={config.quote.max_display_chars}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <NumberStepper
              value={value}
              min={1}
              max={10000}
              step={50}
              onChange={setValue}
              ariaLabel={t('settings.display.maxDisplayChars')}
            />
          )}
        />
        <SaveField
          section="quote"
          fieldKey="max_context_length"
          label={t('settings.display.maxContextLength')}
          helper={t(configHelp('quote', 'max_context_length'))}
          initialValue={config.quote.max_context_length}
          resyncToken={resyncToken}
          onSaved={onSaved}
          render={(value, setValue) => (
            <NumberStepper
              value={value}
              min={1}
              max={65536}
              step={256}
              onChange={setValue}
              ariaLabel={t('settings.display.maxContextLength')}
            />
          )}
        />
      </Section>

      <Section heading={t('settings.section.language')}>
        <SettingRow label={t('settings.display.language')}>
          <Dropdown
            value={locale}
            options={SUPPORTED_LOCALES}
            onChange={setLocale}
            formatOption={languageLabel}
            ariaLabel={t('settings.display.language')}
          />
        </SettingRow>
      </Section>

      <Section heading={t('settings.section.startup')}>
        <SettingRow label={t('settings.display.startOnBoot')}>
          <Toggle
            checked={autoStart === true}
            onChange={(next) => void handleAutoStartToggle(next)}
            ariaLabel={t('settings.display.startOnBoot')}
          />
        </SettingRow>
        {autoStartError && (
          <p
            role="alert"
            style={{
              fontSize: 11,
              color: '#f87171',
              margin: '4px 0 0',
              lineHeight: 1.4,
            }}
          >
            {t('settings.display.startOnBootError')}
          </p>
        )}
      </Section>
    </>
  );
}
