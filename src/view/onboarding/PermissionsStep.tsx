import { motion } from 'framer-motion';
import type React from 'react';
import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import quickaiLogo from '../../../src-tauri/icons/128x128.png';
import { useTranslation } from '../../i18n';

/** Inline keyboard key chip for showing hotkey symbols. */
const KeyChip = ({ label }: { label: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1px 5px',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderBottom: '2px solid rgba(255,255,255,0.12)',
      borderRadius: 4,
      fontSize: 11,
      lineHeight: 1.4,
      color: 'rgba(255,255,255,0.75)',
      verticalAlign: 'middle',
      margin: '0 1px',
      fontFamily: "system-ui, 'Segoe UI Variable', 'Segoe UI', sans-serif",
    }}
  >
    {label}
  </span>
);

/** Keyboard icon for the activation-hotkey card. */
const KeyboardIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="2"
      y="4"
      width="14"
      height="10"
      rx="2"
      stroke="#ff8d5c"
      strokeWidth="1.5"
    />
    <path
      d="M5 8h1M8 8h1M11 8h1M5 11h8"
      stroke="#ff8d5c"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Onboarding screen shown at first launch.
 *
 * QuickAI is Windows-only, where the accessibility and screen-capture access
 * the overlay needs are granted by the OS — there is no permission gate. This
 * screen therefore explains the activation hotkey and offers a restart so the
 * app picks up the freshly-registered hotkey.
 */
export function PermissionsStep() {
  const { t } = useTranslation();

  const handleQuitAndRelaunch = useCallback(async () => {
    await invoke('quit_and_relaunch');
  }, []);

  return (
    // Transparent outer container so the rounded panel corners show through
    // against the desktop (window has transparent: true in tauri.conf.json).
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        fontFamily:
          "Inter, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        style={{
          width: 420,
          background:
            'radial-gradient(ellipse 80% 55% at 50% 0%, rgba(255,141,92,0.14) 0%, rgba(28,24,20,0.97) 60%), rgba(28,24,20,0.97)',
          border: '1px solid rgba(255, 141, 92, 0.2)',
          borderRadius: 24,
          padding: '32px 26px 26px',
          // Drop shadow handled by the OS window manager. CSS provides the
          // warm inner glow only.
          boxShadow: '0 0 40px rgba(255,100,40,0.07)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Top edge highlight */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            background:
              'linear-gradient(90deg, transparent, rgba(255,141,92,0.4), transparent)',
          }}
        />

        {/* Logo mark + title, drag region so the user can reposition the
            onboarding window when it overlaps other windows. */}
        <div
          data-tauri-drag-region
          style={{ textAlign: 'center', marginBottom: 18, cursor: 'grab' }}
        >
          <img
            src={quickaiLogo}
            width={64}
            height={64}
            alt={t('app.name')}
            style={{
              objectFit: 'contain',
              pointerEvents: 'none',
              display: 'block',
              margin: '0 auto',
            }}
          />
        </div>

        {/* Title */}
        <h1
          style={{
            textAlign: 'center',
            fontSize: 22,
            fontWeight: 700,
            color: '#f0f0f2',
            letterSpacing: '-0.4px',
            lineHeight: 1.2,
            margin: '0 0 10px',
          }}
        >
          {t('onboarding.permissions.title')}
        </h1>

        <p
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: '#6b6660',
            lineHeight: 1.5,
            margin: '0 0 20px',
          }}
        >
          {t('onboarding.permissions.ready')}
        </p>

        {/* Activation hotkey */}
        <StepCard>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,141,92,0.12)',
              border: '1px solid rgba(255,141,92,0.25)',
            }}
          >
            <KeyboardIcon />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: '#f0f0f2',
                marginBottom: 2,
              }}
            >
              {t('onboarding.permissions.hotkeyTitle')}
            </div>
            <div style={{ fontSize: 12, color: '#6b6660', lineHeight: 1.5 }}>
              {t('onboarding.permissions.hotkeyDesc')}
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <KeyChip label="Ctrl" />
            <KeyChip label="Ctrl" />
          </div>
        </StepCard>

        {/* CTA: Quit & Reopen */}
        <div style={{ marginTop: 20 }}>
          <CTAButton
            onClick={handleQuitAndRelaunch}
            aria-label={t('onboarding.permissions.quitRelaunch')}
          >
            {t('onboarding.permissions.quitRelaunch')}
          </CTAButton>
        </div>

        <p
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: 'rgba(107,102,96,0.8)',
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          {t('onboarding.permissions.restartHint')}
        </p>
      </motion.div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface CTAButtonProps {
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  'aria-label': string;
  children: React.ReactNode;
}

/** Primary action button with a subtle lift-and-brighten hover effect. */
function CTAButton({
  onClick,
  'aria-label': ariaLabel,
  children,
}: CTAButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        padding: '13px',
        background: 'linear-gradient(135deg, #ff8d5c 0%, #d45a1e 100%)',
        color: 'white',
        fontSize: 14,
        fontWeight: 600,
        border: 'none',
        borderRadius: 14,
        cursor: 'pointer',
        letterSpacing: '-0.1px',
        marginBottom: 10,
        boxShadow:
          '0 4px 24px rgba(255,100,40,0.35), 0 1px 0 rgba(255,255,255,0.12) inset',
        filter: hovered ? 'brightness(1.1)' : 'none',
        transition: 'filter 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

/** Bordered row used for the activation-hotkey card. */
function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        borderRadius: 16,
        border: '1px solid rgba(255,141,92,0.25)',
        background: 'rgba(255,141,92,0.06)',
      }}
    >
      {children}
    </div>
  );
}
