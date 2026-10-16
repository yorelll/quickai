/**
 * About tab - app identity, version, links, and file actions.
 *
 * The shortcut/command reference and the help text are long, so each lives in
 * a scrollable popup opened from a compact row instead of stretching the page.
 *
 * Windows-adapted: no macOS permissions (Accessibility/Screen Recording),
 * uses Windows-style file reveal.
 */

import { useState } from 'react';

import { invoke } from '@tauri-apps/api/core';

import quickaiLogo from '../../../src-tauri/icons/128x128.png';
import pkg from '../../../package.json';
import { COMMANDS } from '../../config/commands';
import { normalizeHotkey, hotkeyLabelKey } from '../hotkeys';
import { Section, ConfirmDialog, InfoDialog } from '../components';
import { useTranslation } from '../../i18n';
import styles from '../../styles/settings.module.css';
import type { RawAppConfig } from '../types';

interface AboutTabProps {
  config: RawAppConfig;
  onSaved: (next: RawAppConfig) => void;
  onReload: () => Promise<void>;
}

const REPO_URL = 'https://github.com/yorelll/quickai';

/** Which reference popup is open, if any. */
type ReferenceDialog = 'shortcuts' | 'help';

export function AboutTab({ config, onSaved, onReload }: AboutTabProps) {
  const { t } = useTranslation();
  const sha = import.meta.env.VITE_GIT_COMMIT_SHA?.slice(0, 7);
  const APP_VERSION = sha ? `${pkg.version}+nightly.${sha}` : pkg.version;
  const releaseUrl = `${REPO_URL}/releases/tag/v${pkg.version}`;
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [openDialog, setOpenDialog] = useState<ReferenceDialog | null>(null);
  const hotkey = t(hotkeyLabelKey(normalizeHotkey(config.general.hotkey)));

  return (
    <div className={styles.aboutBody}>
      <div className={styles.aboutHero}>
        <img
          src={quickaiLogo}
          alt={t('app.name')}
          className={styles.aboutHeroLogo}
          draggable={false}
        />
        <div className={styles.aboutHeroTitle}>{t('app.name')}</div>
        <button
          type="button"
          className={styles.aboutHeroVersion}
          aria-label={t('about.versionLabel', { version: APP_VERSION })}
          onClick={() => void invoke('open_url', { url: releaseUrl })}
        >
          v{APP_VERSION}
        </button>
        <div className={styles.aboutHeroTagline}>
          {t('about.tagline')}
          <br />
          <span className={styles.aboutHeroMantra}>{t('about.mantra')}</span>
        </div>
        <div className={styles.aboutHeroActions}>
          <button
            type="button"
            className={styles.iconLinkBtn}
            aria-label={t('about.githubLabel')}
            onClick={() => void invoke('open_url', { url: REPO_URL })}
          >
            <GitHubIcon />
          </button>
          <button
            type="button"
            className={styles.iconLinkBtn}
            aria-label={t('about.feedbackLabel')}
            onClick={() =>
              void invoke('open_url', { url: `${REPO_URL}/issues` })
            }
          >
            <FeedbackIcon />
          </button>
        </div>
      </div>

      <div className={styles.aboutRefList}>
        <button
          type="button"
          className={styles.aboutRefRow}
          onClick={() => setOpenDialog('shortcuts')}
        >
          <span className={styles.aboutRefLabel}>
            {t('settings.section.shortcuts')}
          </span>
          <ChevronIcon />
        </button>
        <button
          type="button"
          className={styles.aboutRefRow}
          onClick={() => setOpenDialog('help')}
        >
          <span className={styles.aboutRefLabel}>
            {t('settings.section.help')}
          </span>
          <ChevronIcon />
        </button>
      </div>

      <Section heading={t('settings.section.file')}>
        <div className={styles.aboutLinkRow}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonGhost}`}
            onClick={() => void invoke('reveal_config_in_explorer')}
          >
            {t('about.revealData')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonGhost}`}
            onClick={() => void onReload()}
          >
            {t('about.refreshConfig')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonDestructive}`}
            onClick={() => setConfirmResetAll(true)}
          >
            {t('about.resetAll')}
          </button>
        </div>
      </Section>

      <Section heading={t('settings.section.danger')}>
        <p className={styles.helpText}>{t('about.license')}</p>
      </Section>

      <InfoDialog
        open={openDialog === 'shortcuts'}
        title={t('settings.section.shortcuts')}
        onClose={() => setOpenDialog(null)}
      >
        <InfoRow
          keys={t('about.keys.summon', { key: hotkey })}
          label={t('about.shortcut.summon')}
        />
        <InfoRow keys={t('about.keys.save')} label={t('about.shortcut.save')} />
        <InfoRow keys={t('about.keys.new')} label={t('about.shortcut.new')} />
        <InfoRow
          keys={t('about.keys.history')}
          label={t('about.shortcut.history')}
        />
        <InfoRow keys={t('about.keys.copy')} label={t('about.shortcut.copy')} />
        <InfoRow keys={t('about.keys.hide')} label={t('about.shortcut.hide')} />
        <InfoRow
          keys={t('about.keys.scroll')}
          label={t('about.shortcut.scroll')}
        />
        <InfoRow
          keys={t('about.keys.settings')}
          label={t('about.shortcut.settings')}
        />
        <InfoRow
          keys={t('about.keys.closeSettings')}
          label={t('about.shortcut.closeSettings')}
        />
        <InfoRow
          keys={t('about.keys.agentAllow')}
          label={t('about.shortcut.agentAllow')}
        />
        <InfoRow
          keys={t('about.keys.agentDeny')}
          label={t('about.shortcut.agentDeny')}
        />
        <InfoRow
          keys={t('about.keys.agentAbort')}
          label={t('about.shortcut.agentAbort')}
        />

        <p className={styles.helpText}>{t('about.commandsIntro')}</p>
        {COMMANDS.map((command) => (
          <InfoRow
            key={command.trigger}
            keys={command.trigger}
            label={t(command.descriptionKey)}
          />
        ))}
      </InfoDialog>

      <InfoDialog
        open={openDialog === 'help'}
        title={t('settings.section.help')}
        onClose={() => setOpenDialog(null)}
      >
        <h4 className={styles.helpHeading}>{t('about.help.featuresTitle')}</h4>
        <p className={styles.helpText}>{t('about.help.features')}</p>
        <h4 className={styles.helpHeading}>{t('about.help.usageTitle')}</h4>
        <p className={styles.helpText}>
          {t('about.help.usage', { key: hotkey })}
        </p>
        <h4 className={styles.helpHeading}>{t('about.help.trayTitle')}</h4>
        <p className={styles.helpText}>{t('about.help.tray')}</p>
      </InfoDialog>

      <ConfirmDialog
        open={confirmResetAll}
        title={t('about.resetTitle')}
        message={t('about.resetMessage')}
        confirmLabel={t('about.resetConfirm')}
        destructive
        onConfirm={() => {
          setConfirmResetAll(false);
          void invoke<RawAppConfig>('reset_config', { section: null }).then(
            onSaved,
          );
        }}
        onCancel={() => setConfirmResetAll(false)}
      />
    </div>
  );
}

/** One keyboard-shortcut or slash-command row: keys on the left, label next. */
function InfoRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className={styles.infoRow}>
      <kbd className={styles.infoKeys}>{keys}</kbd>
      <span className={styles.infoLabel}>{label}</span>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.96 10.96 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
