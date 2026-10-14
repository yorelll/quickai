import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStatus } from '../hooks/useAgentMode';
import type { AgentAction } from '../types/agent';
import { formatAgentAction } from '../utils/agentAction';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useTranslation, type TranslationKey } from '../i18n';

interface AgentIndicatorProps {
  isActive: boolean;
  status: AgentStatus;
  lastAction: AgentAction | null;
  /** Model-produced result for the last action, or the failure message. */
  lastResult: string | null;
  reasoning: string | null;
  summary: string | null;
  pendingConfirmation: AgentAction | null;
  onStop: () => void;
  onConfirm: () => void;
  onReject: () => void;
  /** Clears the panel once a run has finished or failed. */
  onDismiss: () => void;
}

const statusLabels: Record<AgentStatus, TranslationKey> = {
  idle: 'agent.status.idle',
  capturing: 'agent.status.capturing',
  analyzing: 'agent.status.analyzing',
  executing: 'agent.status.executing',
  waiting_confirmation: 'agent.status.waitingConfirmation',
  done: 'agent.status.done',
  error: 'agent.status.error',
};

const statusColors: Record<AgentStatus, string> = {
  idle: 'bg-neutral-500',
  capturing: 'bg-amber-400',
  analyzing: 'bg-amber-400',
  executing: 'bg-amber-400',
  waiting_confirmation: 'bg-yellow-400',
  done: 'bg-emerald-400',
  error: 'bg-red-400',
};

/** Hoisted dismiss (X) icon. */
const CLOSE_ICON = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const AgentConfirmation = memo(function AgentConfirmation({
  action,
  onConfirm,
  onReject,
}: {
  action: AgentAction;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
      <p className="text-xs text-yellow-200 font-medium">
        {t('agent.confirmPrompt')}
      </p>
      <p className="text-xs text-neutral-300 leading-relaxed">
        {formatAgentAction(action, t)}
      </p>
      <div className="flex gap-2 mt-1">
        <button
          onClick={onConfirm}
          className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-colors cursor-pointer"
        >
          {t('agent.allow')}
        </button>
        <button
          onClick={onReject}
          className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-neutral-700/50 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
        >
          {t('agent.deny')}
        </button>
      </div>
      <p className="text-[10px] text-neutral-500">{t('agent.keyboardHint')}</p>
    </div>
  );
});

export function AgentIndicator({
  isActive,
  status,
  lastAction,
  lastResult,
  reasoning,
  summary,
  pendingConfirmation,
  onStop,
  onConfirm,
  onReject,
  onDismiss,
}: AgentIndicatorProps) {
  const { t } = useTranslation();
  // Terminal states keep the panel mounted so the closing summary and the
  // error message actually reach the DOM: `useAgentMode` clears `isActive` in
  // the same batch that sets `done`/`error`.
  const visible = isActive || status === 'done' || status === 'error';
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm">
            <span
              className={`w-2 h-2 rounded-full ${statusColors[status]} animate-pulse`}
            />
            <span className="text-amber-200 font-medium">
              {t(statusLabels[status])}
            </span>
            {lastAction && (
              <span className="text-neutral-400 text-xs truncate max-w-[200px]">
                {formatAgentAction(lastAction, t)}
              </span>
            )}
            {reasoning && status === 'analyzing' && (
              <span className="text-neutral-500 text-xs truncate max-w-[300px]">
                {reasoning}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {/* A running agent is aborted with Stop; Dismiss only closes a
                  finished/failed panel. */}
              {isActive ? (
                <button
                  onClick={onStop}
                  className="text-neutral-400 hover:text-red-400 transition-colors text-xs font-medium cursor-pointer"
                >
                  {t('agent.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={t('agent.dismiss')}
                  className="w-5 h-5 flex items-center justify-center rounded text-neutral-400 hover:text-text-primary hover:bg-white/8 transition-colors duration-150 cursor-pointer"
                >
                  {CLOSE_ICON}
                </button>
              )}
            </div>
          </div>
          {status === 'error' && lastResult && (
            <div className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300 leading-relaxed">
              {lastResult}
            </div>
          )}
          {summary && (
            <div className="px-3 py-2 bg-surface-elevated border border-surface-border rounded-lg text-xs text-text-primary max-h-[200px] overflow-y-auto select-text">
              <MarkdownRenderer content={summary} />
            </div>
          )}
          {pendingConfirmation && (
            <AgentConfirmation
              action={pendingConfirmation}
              onConfirm={onConfirm}
              onReject={onReject}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
