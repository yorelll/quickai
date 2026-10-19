import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import quickaiLogo from '../../../src-tauri/icons/128x128.png';
import { useTranslation } from '../../i18n';

interface Props {
  onComplete: () => void;
}

/**
 * The translucent "glass" panel shared by both onboarding steps. Every colour
 * is a theme token (mixed with `transparent` via `color-mix()` where a
 * translucent layer is needed) so the panel follows the theme switch instead
 * of being pinned to the dark palette.
 */
const PANEL_BG =
  'radial-gradient(ellipse 80% 55% at 50% 0%, color-mix(in srgb, var(--color-primary) 10%, transparent) 0%, color-mix(in srgb, var(--color-surface-elevated) 97%, transparent) 60%), color-mix(in srgb, var(--color-surface-elevated) 97%, transparent)';

export function IntroStep({ onComplete }: Props) {
  const { t } = useTranslation();

  const handleGetStarted = async () => {
    await invoke('finish_onboarding');
    onComplete();
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        style={{
          width: 420,
          background: PANEL_BG,
          border: '1px solid var(--color-surface-border)',
          borderRadius: 8,
          padding: '32px 26px 26px',
          boxShadow:
            '0 0 40px color-mix(in srgb, var(--color-primary) 12%, transparent)',
          position: 'relative',
        }}
      >
        {/* Logo */}
        <img
          src={quickaiLogo}
          width={44}
          height={44}
          alt={t('app.name')}
          style={{
            objectFit: 'contain',
            display: 'block',
            margin: '0 auto 16px',
            pointerEvents: 'none',
          }}
        />

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1
            style={{
              fontSize: 21,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.5px',
              lineHeight: 1.25,
              margin: '0 0 6px',
            }}
          >
            {t('onboarding.intro.title')}
          </h1>
          <p
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {t('onboarding.intro.subtitle')}
          </p>
        </div>

        {/* Facts */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Fact
            icon={<KeyboardIcon />}
            title={
              <>
                <span>{t('onboarding.intro.summonPrefix')}</span>{' '}
                <KeyChip>Ctrl</KeyChip>{' '}
                <span>{t('onboarding.intro.summonSuffix')}</span>
              </>
            }
            desc={t('onboarding.intro.summonDesc')}
          />
          <Fact
            icon={<SelectionIcon />}
            title={
              <>
                <span>{t('onboarding.intro.selectPrefix')}</span>{' '}
                <KeyChip>Ctrl</KeyChip>
              </>
            }
            desc={t('onboarding.intro.selectDesc')}
          />
          <Fact
            icon={<ImageIcon />}
            title={t('onboarding.intro.imageTitle')}
            desc={t('onboarding.intro.imageDesc')}
          />
          <Fact
            icon={<ScreenIcon />}
            title={
              <>
                <span>{t('onboarding.intro.screenPrefix')}</span>{' '}
                <MonoChip>/screen</MonoChip>{' '}
                <span>{t('onboarding.intro.screenSuffix')}</span>
              </>
            }
            desc={t('onboarding.intro.screenDesc')}
          />
          <Fact
            icon={<FloatIcon />}
            title={t('onboarding.intro.floatTitle')}
            desc={t('onboarding.intro.floatDesc')}
            last
          />
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: 'var(--color-divider)',
            margin: '16px 0',
          }}
        />

        {/* CTA */}
        <button
          onClick={() => void handleGetStarted()}
          aria-label={t('onboarding.intro.getStarted')}
          style={{
            display: 'block',
            width: '100%',
            padding: '12px',
            background:
              'linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 85%, #000) 100%)',
            color: 'var(--color-on-primary)',
            fontSize: 14,
            fontWeight: 600,
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            letterSpacing: '-0.1px',
            boxShadow:
              '0 4px 20px color-mix(in srgb, var(--color-primary) 30%, transparent)',
            textAlign: 'center',
          }}
        >
          {t('onboarding.intro.getStarted')}
        </button>

        {/* Footer */}
        <p
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--color-text-disabled)',
            marginTop: 14,
            lineHeight: 1.5,
          }}
        >
          {t('onboarding.intro.footer')}
        </p>
      </motion.div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface FactProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  desc: string;
  last?: boolean;
}

function Fact({ icon, title, desc, last = false }: FactProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '11px 0',
        borderBottom: last ? 'none' : '1px solid var(--color-divider)',
      }}
    >
      <div
        style={{
          width: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          paddingTop: 1,
          color: 'var(--color-primary)',
        }}
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
            lineHeight: 1.4,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        background: 'var(--color-state-hover)',
        border: '1px solid var(--color-surface-border)',
        borderBottom: '2px solid var(--color-divider)',
        borderRadius: 4,
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        lineHeight: 1.5,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}

function MonoChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
        border:
          '1px solid color-mix(in srgb, var(--color-primary) 28%, transparent)',
        borderRadius: 4,
        fontSize: 11,
        color: 'var(--color-primary)',
        fontFamily: "'Cascadia Code', 'Consolas', 'Fira Mono', monospace",
        lineHeight: 1.5,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}

function KeyboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="4"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5 8h1M8 8h1M11 8h1M5 11h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SelectionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="6"
        width="10"
        height="6"
        rx="1.5"
        fill="currentColor"
        opacity="0.18"
      />
      <rect
        x="2"
        y="6"
        width="10"
        height="6"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M14 4v10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12 4h4M12 14h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="4"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2 11l3.5-3.5 3 3 2.5-2.5 4 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <circle cx="6" cy="7.5" r="1.2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="5"
        width="14"
        height="9"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="9" cy="9.5" r="2" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function FloatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="7"
        width="12"
        height="8"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.4"
      />
      <rect
        x="4"
        y="3"
        width="12"
        height="8"
        rx="2"
        fill="var(--color-surface-base)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
