/**
 * Reusable form primitives for the Settings panel.
 */

import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import styles from '../../styles/settings.module.css';
import { describeConfigError } from '../types';
import type { ConfigError } from '../types';
import { useTranslation } from '../../i18n';

// ─── Section + Row layout ────────────────────────────────────────────────

export function Section({
  heading,
  children,
}: {
  heading: string;
  children?: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>{heading}</div>
      {children}
    </section>
  );
}

export function SettingRow({
  label,
  helper,
  error,
  children,
}: {
  label: string;
  helper?: string;
  error?: ConfigError | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const infoBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={styles.row} role="group" aria-labelledby={labelId}>
      <div className={styles.rowLabelGroup}>
        <label id={labelId} className={styles.rowLabel}>
          {label}
        </label>
        {helper ? (
          <button
            ref={infoBtnRef}
            type="button"
            className={styles.infoBtn}
            aria-label={t('settings.fieldHelp', { label })}
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
            onFocus={() => setTooltipVisible(true)}
            onBlur={() => setTooltipVisible(false)}
          >
            ?
            <div
              className={`${styles.infoTooltip} ${tooltipVisible ? styles.infoTooltipVisible : ''}`}
              role="tooltip"
            >
              {helper}
            </div>
          </button>
        ) : null}
      </div>
      <div className={styles.rowControl}>
        {children}
        {error ? (
          <div className={styles.rowError} role="alert">
            {describeConfigError(error, t)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Inputs ──────────────────────────────────────────────────────────────

export function TextField({
  value,
  onChange,
  placeholder,
  errored,
  ariaLabel,
  list,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  errored?: boolean;
  ariaLabel?: string;
  /** Id of a `<datalist>` supplying suggestions for this input. */
  list?: string;
}) {
  return (
    <input
      type="text"
      className={`${styles.input} ${errored ? styles.inputError : ''}`}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      list={list}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
    />
  );
}

// ─── Slider (NumberSlider) ──────────────────────────────────────────────

export function NumberSlider({
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (next: number) => void;
  ariaLabel?: string;
}) {
  const [local, setLocal] = useState(value);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setLocal(value);
  }, [value]);

  return (
    <div className={styles.sliderRow}>
      <input
        type="range"
        className={styles.sliderInput}
        min={min}
        max={max}
        step={step}
        value={local}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={local}
        aria-valuetext={unit ? `${local} ${unit}` : `${local}`}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          draggingRef.current = true;
          setLocal(Number(e.target.value));
        }}
        onMouseUp={() => {
          draggingRef.current = false;
          if (local !== value) onChange(local);
        }}
        onTouchEnd={() => {
          draggingRef.current = false;
          if (local !== value) onChange(local);
        }}
        onBlur={() => {
          draggingRef.current = false;
          if (local !== value) onChange(local);
        }}
        onKeyUp={() => {
          if (local !== value) onChange(local);
        }}
      />
      <div className={styles.valChip} aria-hidden>
        {unit ? `${local} ${unit}` : local}
      </div>
    </div>
  );
}

// ─── Stepper (NumberStepper) ────────────────────────────────────────────

export function NumberStepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const decrement = () => onChange(value - step);
  const increment = () => onChange(value + step);
  return (
    <div
      className={styles.stepper}
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
    >
      <button
        type="button"
        className={styles.stepperBtn}
        onClick={decrement}
        disabled={value - step < min}
        aria-label={t('settings.decrease')}
      >
        -
      </button>
      <div className={styles.stepperValue}>{value}</div>
      <button
        type="button"
        className={styles.stepperBtn}
        onClick={increment}
        disabled={value + step > max}
        aria-label={t('settings.increase')}
      >
        +
      </button>
    </div>
  );
}

// ─── Dropdown ───────────────────────────────────────────────────────────

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  formatOption,
}: {
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  ariaLabel?: string;
  /** Optional label formatter so option values can be localized. */
  formatOption?: (option: T) => string;
}) {
  return (
    <select
      className={styles.dropdown}
      value={value}
      aria-label={ariaLabel}
      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
        onChange(e.target.value as T)
      }
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {formatOption ? formatOption(opt) : opt}
        </option>
      ))}
    </select>
  );
}

// ─── Toggle switch ───────────────────────────────────────────────────────

export function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleThumb} />
    </button>
  );
}

// ─── SavedPill ──────────────────────────────────────────────────────────

export function SavedPill({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={`${styles.savedPill} ${visible ? styles.savedPillVisible : ''}`}
      aria-live="polite"
      role="status"
    >
      {t('settings.saved')}
    </div>
  );
}

// ─── Confirm dialog ─────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className={styles.dialogBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div className={styles.dialog}>
        <h2 id="dialog-title" className={styles.dialogTitle}>
          {title}
        </h2>
        <p className={styles.dialogMessage}>{message}</p>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonGhost}`}
            onClick={onCancel}
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${destructive ? styles.buttonDestructive : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Info dialog ────────────────────────────────────────────────────────

/**
 * Scrollable read-only popup used for long reference content (shortcuts,
 * help). Escape and the Close button dismiss it.
 */
export function InfoDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={styles.dialogBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={`${styles.dialog} ${styles.dialogWide}`}>
        <h2 id={titleId} className={styles.dialogTitle}>
          {title}
        </h2>
        <div className={styles.dialogBody}>{children}</div>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonGhost}`}
            onClick={onClose}
            autoFocus
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Error dialog ───────────────────────────────────────────────────────

/**
 * A dismissible error popup: a title and one specific message, closed with the
 * × control or Escape.
 *
 * Settings errors are shown here rather than as inline alerts. An inline alert
 * has no dismissal, and the settings UI now outlives both a tab switch (tabs
 * stay mounted when hidden) and closing the window (the close button hides the
 * window instead of destroying it), so an inline alert would sit there until
 * the app restarts. The popup stays gone once dismissed and opens again only
 * when a later action fails.
 */
export function ErrorDialog({
  open,
  title,
  message,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={styles.dialogBackdrop}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <div className={styles.dialog}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h2 id={titleId} className={styles.dialogTitle} style={{ margin: 0 }}>
            {title}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            style={{ flexShrink: 0, margin: '-6px -10px 0 0' }}
            onClick={onClose}
            aria-label={t('common.close')}
            autoFocus
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden
            >
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <p
          id={messageId}
          className={styles.dialogMessage}
          style={{ margin: '12px 0 0' }}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
