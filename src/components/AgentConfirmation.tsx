import { memo, useCallback, useEffect, useState } from 'react';
import type { AgentAction } from '../types/agent';
import { formatAgentAction } from '../utils/agentAction';
import { useTranslation } from '../i18n';

/** The two choices, in the order they are rendered. */
type ConfirmationChoice = 'allow' | 'deny';

interface AgentConfirmationProps {
  /** The structured action awaiting approval, localized at render time. */
  action: AgentAction;
  /** Approve the action — the 允许 choice. */
  onConfirm: () => void;
  /** Refuse the action — the 拒绝 choice. */
  onReject: () => void;
}

/**
 * Per-choice styling. The selected choice carries a ring so the keyboard
 * selection is visible, not merely implied by focus.
 */
function choiceClass(choice: ConfirmationChoice, selected: boolean): string {
  const base =
    'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer';
  if (selected) {
    return choice === 'allow'
      ? `${base} ring-2 ring-tertiary bg-tertiary/20 text-text-primary`
      : `${base} ring-2 ring-status-error bg-status-error/10 text-status-error`;
  }
  return `${base} bg-surface-elevated text-text-secondary hover:bg-state-hover hover:text-text-primary`;
}

/**
 * Explicit confirmation prompt for a dangerous agent action (item 12).
 *
 * Two visible choices with **允许 selected by default**; ←/→ move the selection
 * and Enter activates it. `1` / `2` / `Ctrl+C` keep working from `App.tsx`'s
 * global handler and are deliberately untouched here.
 *
 * The key listener runs in the **capture** phase and stops propagation: the
 * overlay's textarea holds focus whenever the bar is open, so a bubble-phase
 * handler (or none at all) would let the input swallow the keys — the exact
 * batch-2 bug. `SwitchConfirmation` uses the same technique.
 */
export const AgentConfirmation = memo(function AgentConfirmation({
  action,
  onConfirm,
  onReject,
}: AgentConfirmationProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ConfirmationChoice>('allow');

  const activate = useCallback(
    (selected: ConfirmationChoice) => {
      if (selected === 'allow') {
        onConfirm();
      } else {
        onReject();
      }
    },
    [onConfirm, onReject],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.stopPropagation();
        event.preventDefault();
        setChoice('allow');
        return;
      }
      if (event.key === 'ArrowRight') {
        event.stopPropagation();
        event.preventDefault();
        setChoice('deny');
        return;
      }
      if (event.key === 'Enter') {
        event.stopPropagation();
        event.preventDefault();
        activate(choice);
      }
    };
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [activate, choice]);

  return (
    <div className="flex flex-col gap-2 p-3 bg-tertiary/10 border border-tertiary/30 rounded-lg">
      <p className="text-xs text-text-primary font-medium">
        {t('agent.confirmPrompt')}
      </p>
      <p className="text-xs text-text-secondary leading-relaxed">
        {formatAgentAction(action, t)}
      </p>
      <div
        className="flex gap-2 mt-1"
        role="group"
        aria-label={t('agent.confirmPrompt')}
      >
        <button
          type="button"
          onClick={onConfirm}
          aria-pressed={choice === 'allow'}
          className={choiceClass('allow', choice === 'allow')}
        >
          {t('agent.allow')}
        </button>
        <button
          type="button"
          onClick={onReject}
          aria-pressed={choice === 'deny'}
          className={choiceClass('deny', choice === 'deny')}
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
