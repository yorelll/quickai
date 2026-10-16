import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStatus } from '../hooks/useAgentMode';
import type { AgentAction, AgentNotice } from '../types/agent';
import { formatAgentAction } from '../utils/agentAction';
import { ErrorCard } from './ErrorCard';
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
  /** Non-fatal diagnostic raised mid-run; shown without ending the run. */
  notice: AgentNotice | null;
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
  idle: 'bg-text-secondary',
  capturing: 'bg-tertiary',
  analyzing: 'bg-tertiary',
  executing: 'bg-tertiary',
  waiting_confirmation: 'bg-tertiary',
  done: 'bg-[light-dark(#1a7f37,#4ade80)]',
  error: 'bg-[light-dark(#b3261e,#ff8a80)]',
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
    <div className="flex flex-col gap-2 p-3 bg-tertiary/10 border border-tertiary/30 rounded-lg">
      <p className="text-xs text-text-primary font-medium">
        {t('agent.confirmPrompt')}
      </p>
      <p className="text-xs text-text-secondary leading-relaxed">
        {formatAgentAction(action, t)}
      </p>
      <div className="flex gap-2 mt-1">
        <button
          onClick={onConfirm}
          className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-tertiary/20 text-text-primary hover:bg-tertiary/30 transition-colors cursor-pointer"
        >
          {t('agent.allow')}
        </button>
        <button
          onClick={onReject}
          className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-elevated text-text-secondary hover:text-[light-dark(#b3261e,#ff8a80)] hover:bg-[light-dark(rgba(179,38,30,0.08),rgba(255,138,128,0.10))] transition-colors cursor-pointer"
        >
          {t('agent.deny')}
        </button>
      </div>
      <p className="text-[10px] text-text-secondary">
        {t('agent.keyboardHint')}
      </p>
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
  notice,
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
          <div className="flex items-center gap-2 px-3 py-1.5 bg-tertiary/10 border border-tertiary/30 rounded-lg text-sm">
            <span
              className={`w-2 h-2 rounded-full ${statusColors[status]} animate-pulse`}
            />
            <span className="text-text-primary font-medium">
              {t(statusLabels[status])}
            </span>
            {lastAction && (
              <span className="text-text-secondary text-xs truncate max-w-[200px]">
                {formatAgentAction(lastAction, t)}
              </span>
            )}
            {reasoning && status === 'analyzing' && (
              <span className="text-text-secondary text-xs truncate max-w-[300px]">
                {reasoning}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {/* A running agent is aborted with Stop; Dismiss only closes a
                  finished/failed panel. */}
              {isActive ? (
                <button
                  onClick={onStop}
                  className="text-text-secondary hover:text-[light-dark(#b3261e,#ff8a80)] transition-colors text-xs font-medium cursor-pointer"
                >
                  {t('agent.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={t('agent.dismiss')}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-150 cursor-pointer"
                >
                  {CLOSE_ICON}
                </button>
              )}
            </div>
          </div>
          {notice && <ErrorCard code={notice.code} message={notice.message} />}
          {status === 'error' && lastResult && (
            <div className="px-3 py-1.5 bg-[light-dark(rgba(179,38,30,0.08),rgba(255,138,128,0.10))] border border-[light-dark(rgba(179,38,30,0.35),rgba(255,138,128,0.30))] rounded-lg text-xs text-[light-dark(#b3261e,#ff8a80)] leading-relaxed">
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
