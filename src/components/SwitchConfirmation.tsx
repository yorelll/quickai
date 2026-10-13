import { memo, useEffect } from 'react';
import { useTranslation, type TranslationKey } from '../i18n';

type SwitchConfirmationVariant = 'switch' | 'new';

interface SwitchConfirmationProps {
  /** Called when the user wants to save the current session then proceed. */
  onSaveAndSwitch: () => void;
  /** Called when the user wants to discard the current session and proceed. */
  onJustSwitch: () => void;
  /** Called when the user wants to go back without switching. */
  onCancel: () => void;
  /**
   * Controls the title and button labels.
   * - `"switch"` (default) — "Switch conversations?" / "Save & Switch" / "Just Switch"
   * - `"new"` — "New conversation?" / "Save & Start New" / "Start New"
   */
  variant?: SwitchConfirmationVariant;
}

const VARIANT_TEXT: Record<
  SwitchConfirmationVariant,
  { title: TranslationKey; save: TranslationKey; proceed: TranslationKey }
> = {
  switch: {
    title: 'history.switchTitle',
    save: 'history.switchSave',
    proceed: 'history.switchJust',
  },
  new: {
    title: 'history.newTitle',
    save: 'history.newSave',
    proceed: 'history.newJust',
  },
};

/**
 * Inline confirmation prompt displayed inside the history panel when the user
 * needs to decide what to do with the current conversation before proceeding.
 *
 * Two variants:
 * - **switch** — loading an existing conversation.
 * - **new** — starting a fresh conversation via the "+" button.
 *
 * A **Cancel** action returns the user to the previous view.
 */
export const SwitchConfirmation = memo(function SwitchConfirmation({
  onSaveAndSwitch,
  onJustSwitch,
  onCancel,
  variant = 'switch',
}: SwitchConfirmationProps) {
  const { t } = useTranslation();
  const text = VARIANT_TEXT[variant];

  // Keyboard shortcuts: Enter = save & proceed, Escape = cancel.
  // Uses capture phase + stopPropagation so global shortcuts in App.tsx
  // don't fire while this confirmation is visible.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        onSaveAndSwitch();
      }
    };
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onCancel, onSaveAndSwitch]);

  return (
    <div className="px-3 py-3 flex flex-col gap-2.5">
      <p className="text-xs text-text-secondary leading-snug">
        {t(text.title)}
      </p>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onSaveAndSwitch}
          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors duration-150 cursor-pointer"
        >
          {t(text.save)}
        </button>

        <button
          type="button"
          onClick={onJustSwitch}
          className="w-full text-left px-3 py-2 rounded-lg text-xs text-text-primary hover:bg-white/5 transition-colors duration-150 cursor-pointer"
        >
          {t(text.proceed)}
        </button>

        <button
          type="button"
          onClick={onCancel}
          aria-label={t('common.cancel')}
          className="w-full text-left px-3 py-2 rounded-lg text-xs text-text-secondary hover:bg-white/5 transition-colors duration-150 cursor-pointer"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
});
