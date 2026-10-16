/**
 * Top-level component for the Settings window.
 *
 * 5 tabs: General, AI, Display, Agent, About.
 * Uses Ctrl+, and Ctrl+W keyboard shortcuts (Windows convention).
 */

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

import { useConfigSync } from './hooks/useConfigSync';
import { GeneralTab } from './tabs/GeneralTab';
import { AiTab } from './tabs/AiTab';
import { DisplayTab } from './tabs/DisplayTab';
import { AgentTab } from './tabs/AgentTab';
import { AboutTab } from './tabs/AboutTab';
import { SavedPill } from './components';
import { useTranslation, type TranslationKey } from '../i18n';
import styles from '../styles/settings.module.css';
import type { CorruptMarker, RawAppConfig, SettingsTabId } from './types';

const TABS: ReadonlyArray<{
  id: SettingsTabId;
  labelKey: TranslationKey;
  icon: ReactNode;
}> = [
  {
    id: 'general',
    labelKey: 'settings.tab.general',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'ai',
    labelKey: 'settings.tab.ai',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9.5 2a3 3 0 0 0-3 3v.5a2.5 2.5 0 0 0-2 4 3 3 0 0 0 .5 5 2.5 2.5 0 0 0 1.5 4.5 3 3 0 0 0 5.5-1.5V5a3 3 0 0 0-2.5-3z" />
        <path d="M14.5 2a3 3 0 0 1 3 3v.5a2.5 2.5 0 0 1 2 4 3 3 0 0 1-.5 5 2.5 2.5 0 0 1-1.5 4.5 3 3 0 0 1-5.5-1.5V5a3 3 0 0 1 2.5-3z" />
      </svg>
    ),
  },
  {
    id: 'display',
    labelKey: 'settings.tab.display',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: 'agent',
    labelKey: 'settings.tab.agent',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 2a5 5 0 0 1 5 5v1a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" />
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      </svg>
    ),
  },
  {
    id: 'about',
    labelKey: 'settings.tab.about',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
];

const SAVED_PILL_DURATION_MS = 1500;
/**
 * The Settings window is a fixed size: the body scrolls instead. Resizing it
 * per tab meant the window grew on the General→AI / General→Display switches,
 * and each growth re-rasterises the window's backdrop blur — the lag the user
 * reported. One size, set once, keeps every switch cheap and every tab usable.
 */
const SETTINGS_WIDTH = 580;
const SETTINGS_HEIGHT = 700;

/**
 * Tags that must never start a window drag. The drag region is limited to the
 * title row and the tab bar, so this only has to catch the controls in those
 * two bars (the close button and the tabs) and anything inside them.
 */
const INTERACTIVE_TAGS = new Set([
  'TEXTAREA',
  'INPUT',
  'BUTTON',
  'A',
  'SELECT',
  'SVG',
  'PATH',
  'LABEL',
]);

export function SettingsWindow() {
  const { t } = useTranslation();
  const { config, reload, setConfig } = useConfigSync();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
  const [savedVisible, setSavedVisible] = useState(false);
  const [marker, setMarker] = useState<CorruptMarker | null>(null);
  const [markerDismissed, setMarkerDismissed] = useState(false);

  const [resyncToken, setResyncToken] = useState(0);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getCurrentWindow().setSize(
      new LogicalSize(SETTINGS_WIDTH, SETTINGS_HEIGHT),
    );
  }, []);

  const handleSaved = useCallback(
    (next: RawAppConfig) => {
      setConfig(next);
      setResyncToken((prev) => prev + 1);
      setSavedVisible(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSavedVisible(false);
        savedTimerRef.current = null;
      }, SAVED_PILL_DURATION_MS);
    },
    [setConfig],
  );

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    void invoke<CorruptMarker | null>('get_corrupt_marker').then((m) => {
      if (m) setMarker(m);
    });
  }, []);

  // Ctrl+, and Ctrl+W keyboard shortcuts (Windows convention)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        void getCurrentWindow().setFocus();
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        void getCurrentWindow().hide();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleHide = useCallback(() => {
    void getCurrentWindow().hide();
  }, []);

  const handleDragStart = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    let current: HTMLElement | null = e.target as HTMLElement;
    while (current) {
      if (INTERACTIVE_TAGS.has(current.tagName.toUpperCase())) return;
      current = current.parentElement;
    }
    e.preventDefault();
    void getCurrentWindow().startDragging();
  }, []);

  if (!config) return null;

  return (
    <div className={styles.window}>
      {/* Close button for Windows. This title row and the tab bar are the drag
          region: the body below scrolls, so a drag started there (or on the
          scrollbar) would move the window instead of scrolling it. */}
      <div className={styles.closeRow} onMouseDown={handleDragStart}>
        <button
          type="button"
          onClick={handleHide}
          className={styles.closeBtn}
          aria-label={t('settings.close')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1 1L9 9M9 1L1 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {marker && !markerDismissed ? (
        <div className={styles.banner} role="alert">
          <span className={styles.bannerIcon} aria-hidden>
            !
          </span>
          <span className={styles.bannerText}>
            {t('settings.corruptPrefix')}
            <code>config.toml</code>
            {t('settings.corruptMiddle')}
            <code>{baseName(marker.path)}</code>
            {t('settings.corruptSuffix')}
          </span>
          <span className={styles.bannerActions}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonGhost}`}
              onClick={() => void invoke('reveal_config_in_explorer')}
            >
              {t('settings.reveal')}
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonGhost}`}
              onClick={() => setMarkerDismissed(true)}
            >
              {t('settings.dismiss')}
            </button>
          </span>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label={t('settings.sections')}
        className={styles.tabBar}
        onMouseDown={handleDragStart}
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              className={`${styles.tab} ${active ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const idx = TABS.findIndex((t) => t.id === activeTab);
                  const next =
                    e.key === 'ArrowRight'
                      ? TABS[(idx + 1) % TABS.length]
                      : TABS[(idx - 1 + TABS.length) % TABS.length];
                  setActiveTab(next.id);
                }
              }}
            >
              <span className={styles.tabIcon} aria-hidden>
                {tab.icon}
              </span>
              <span className={styles.tabLabel}>{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.body} id={`panel-${activeTab}`} role="tabpanel">
        {activeTab === 'general' ? (
          <GeneralTab
            config={config}
            resyncToken={resyncToken}
            onSaved={handleSaved}
          />
        ) : null}
        {activeTab === 'ai' ? (
          <AiTab
            config={config}
            resyncToken={resyncToken}
            onSaved={handleSaved}
          />
        ) : null}
        {activeTab === 'display' ? (
          <DisplayTab
            config={config}
            resyncToken={resyncToken}
            onSaved={handleSaved}
          />
        ) : null}
        {activeTab === 'agent' ? (
          <AgentTab
            config={config}
            resyncToken={resyncToken}
            onSaved={handleSaved}
          />
        ) : null}
        {activeTab === 'about' ? (
          <AboutTab config={config} onSaved={handleSaved} onReload={reload} />
        ) : null}
      </div>

      <SavedPill visible={savedVisible} />
    </div>
  );
}

function baseName(path: string): string {
  const idx = path.lastIndexOf(
    /[/\\]/.test(path) ? (path.includes('\\') ? '\\' : '/') : '/',
  );
  return idx >= 0 ? path.slice(idx + 1) : path;
}
