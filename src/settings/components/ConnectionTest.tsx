/**
 * "Test connection" control for the AI settings tab (item 13).
 *
 * Probes the configured chat provider through the backend's `test_connection`
 * command and reports the result. Three states are the frontend's own: never
 * tested (the default the user asked for — 连接状态：尚未测试), a probe in
 * flight, and the resolved verdict. The backend has no "untested" outcome.
 *
 * A failure is rendered exactly like a streamed error: the shared
 * `errorTitleKey` mapping supplies the localized copy, and the provider's raw
 * detail is shown beneath it.
 */

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { errorTitleKey } from '../../components/ErrorCard';
import {
  useTranslation,
  type Translate,
  type TranslationKey,
} from '../../i18n';
import { SettingRow } from './index';
import styles from '../../styles/settings.module.css';

/** Result of `test_connection` (T34), internally tagged on `status`. */
export type TestOutcome =
  | { status: 'success' }
  | { status: 'failure'; code: string; message: string };

/**
 * Stable code the backend emits when a `bad_request` body turns out to be a
 * capability rejection (streaming, tools, vision, a parameter).
 */
const UNSUPPORTED_CAPABILITY_CODE = 'unsupported_capability';

/** What the panel is currently showing. */
type Probe =
  | { kind: 'untested' }
  | { kind: 'testing' }
  | { kind: 'success' }
  | { kind: 'failure'; code: string; message: string };

/**
 * Copy key for a probe failure code.
 *
 * Delegates to the shared `errorTitleKey` mapping for every code it knows, and
 * adds only `unsupported_capability` — a code this build emits but the shared
 * map does not yet name. That map lives in a file owned by another task, so the
 * extra case is kept here; fold it into `ErrorCard.tsx` when that file is free.
 */
export function connectionErrorKey(code: string): TranslationKey | null {
  if (code === UNSUPPORTED_CAPABILITY_CODE) {
    return 'error.unsupportedCapability';
  }
  return errorTitleKey(code);
}

/** The localized status line. An unnamed code falls back to the raw detail. */
function probeLabel(probe: Probe, t: Translate): string {
  switch (probe.kind) {
    case 'untested':
      return t('settings.connection.untested');
    case 'testing':
      return t('settings.connection.testing');
    case 'success':
      return t('settings.connection.ok');
    case 'failure': {
      const key = connectionErrorKey(probe.code);
      return key === null ? probe.message : t(key);
    }
  }
}

export function ConnectionTest() {
  const { t } = useTranslation();
  const [probe, setProbe] = useState<Probe>({ kind: 'untested' });

  const run = useCallback(async () => {
    setProbe({ kind: 'testing' });
    try {
      const outcome = await invoke<TestOutcome>('test_connection', {
        scope: 'chat',
      });
      setProbe(
        outcome.status === 'success'
          ? { kind: 'success' }
          : {
              kind: 'failure',
              code: outcome.code,
              message: outcome.message,
            },
      );
    } catch (e) {
      // A rejected promise is an internal failure (a poisoned DB lock), not a
      // connection verdict — report it as an unnamed failure with its detail.
      setProbe({ kind: 'failure', code: 'unknown', message: String(e) });
    }
  }, []);

  const failure = probe.kind === 'failure' ? probe : null;
  const failureKey = failure === null ? null : connectionErrorKey(failure.code);
  const failureDetail =
    failure !== null && failureKey !== null ? failure.message : null;

  return (
    <SettingRow label={t('settings.connection.status')}>
      <div className={styles.fieldWithButton}>
        <span
          className={styles.rowHelper}
          role="status"
          aria-label={t('settings.connection.status')}
        >
          {probeLabel(probe, t)}
        </span>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonGhost}`}
          onClick={() => void run()}
          disabled={probe.kind === 'testing'}
        >
          {t('settings.connection.test')}
        </button>
      </div>
      {failureDetail !== null ? (
        <span className={styles.rowHelper}>{failureDetail}</span>
      ) : null}
    </SettingRow>
  );
}
