/**
 * Display tab - window dimensions and quoted-text preview limits.
 */

import { Section, NumberSlider, NumberStepper } from '../components';
import { SaveField } from '../components/SaveField';
import { configHelp } from '../configHelpers';
import { useTranslation } from '../../i18n';
import type { RawAppConfig } from '../types';

interface DisplayTabProps {
  config: RawAppConfig;
  resyncToken: number;
  onSaved: (next: RawAppConfig) => void;
}

export function DisplayTab({ config, resyncToken, onSaved }: DisplayTabProps) {
  const { t } = useTranslation();

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
    </>
  );
}
