import { motion } from 'framer-motion';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AgentStatus } from '../hooks/useAgentMode';
import { useTranslation } from '../i18n';

interface MinibarViewProps {
  status: AgentStatus | null;
  onClick: () => void;
}

const SUCCESS_DOT = 'bg-status-success';
const ERROR_DOT = 'bg-status-error';

const statusDotColors: Record<string, string> = {
  idle: SUCCESS_DOT,
  capturing: 'bg-tertiary',
  analyzing: 'bg-tertiary',
  executing: 'bg-tertiary',
  done: SUCCESS_DOT,
  error: ERROR_DOT,
};

export function MinibarView({ status, onClick }: MinibarViewProps) {
  const { t } = useTranslation();
  const dotColor = status
    ? (statusDotColors[status] ?? 'bg-text-secondary')
    : SUCCESS_DOT;
  const isPulsing =
    status === 'executing' || status === 'analyzing' || status === 'capturing';

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        // The drag begins: listeners are removed so a later pointerup cannot
        // also fire the click handler.
        cleanup();
        // Start native drag — OS handles the rest including pointer-up.
        void getCurrentWindow().startDragging();
      }
    };

    const onUp = () => {
      cleanup();
      onClick();
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.15 }}
      onPointerDown={handlePointerDown}
      className="relative w-12 h-12 rounded-full bg-surface-base cursor-pointer select-none flex items-center justify-center"
      title={t('minibar.title')}
    >
      <img
        src="quickai-logo.png"
        alt={t('app.name')}
        className="w-7 h-7 rounded-full pointer-events-none"
        draggable={false}
      />
      <span
        className={`absolute top-0 right-0 w-3 h-3 rounded-full ${dotColor} border-2 border-surface-base ${isPulsing ? 'animate-pulse' : ''}`}
      />
    </motion.div>
  );
}
