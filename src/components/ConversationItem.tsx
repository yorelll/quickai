import { memo, useCallback, useState } from 'react';
import type { ConversationSummary } from '../types/history';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { useTranslation } from '../i18n';

/** Hoisted static delete icon — avoids re-allocation on every render. */
const DELETE_ICON = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
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

/**
 * Inline interaction modes for a history row. `menu` is the right-click
 * context menu, `rename` swaps the row for a text field and `confirm-delete`
 * asks for confirmation before the row is removed.
 */
type Mode = 'idle' | 'menu' | 'rename' | 'confirm-delete';

interface ConversationItemProps {
  /** The conversation summary to render. */
  conversation: ConversationSummary;
  /** Called with the conversation id when the row is clicked. */
  onSelect: (id: string) => void;
  /** Called with the conversation id when the delete button is clicked. */
  onDelete: (id: string) => void;
  /** Called with the conversation id and new name when a rename is committed. */
  onRename: (id: string, title: string) => void;
  /** When true, renders the row with an active/highlighted style. */
  isActive?: boolean;
}

/**
 * Renders a single conversation row in the history panel.
 *
 * Displays the conversation title (falling back to "Untitled"), a relative
 * timestamp, and a delete button revealed on hover. The entire row is a
 * button for keyboard accessibility. Right-clicking opens a context menu with
 * Rename and Delete; Delete asks for confirmation first.
 */
export const ConversationItem = memo(function ConversationItem({
  conversation,
  onSelect,
  onDelete,
  onRename,
  isActive = false,
}: ConversationItemProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState('');

  const title = conversation.title ?? t('history.untitled');
  const relative = formatRelativeTime(conversation.updated_at);
  const timeLabel =
    relative.count === undefined
      ? t(relative.key)
      : t(relative.key, { count: relative.count });

  const startRename = useCallback(() => {
    setDraft(conversation.title ?? '');
    setMode('rename');
  }, [conversation.title]);

  const commitRename = useCallback(() => {
    setMode('idle');
    const next = draft.trim();
    if (next.length > 0 && next !== conversation.title) {
      onRename(conversation.id, next);
    }
  }, [draft, conversation.id, conversation.title, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMode('idle');
      }
    },
    [commitRename],
  );

  const handleConfirmDelete = useCallback(() => {
    setMode('idle');
    onDelete(conversation.id);
  }, [onDelete, conversation.id]);

  if (mode === 'rename') {
    return (
      <div className="history-item flex items-center w-full px-3 py-2">
        <input
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleRenameKeyDown}
          aria-label={t('history.rename')}
          className="flex-1 min-w-0 bg-transparent text-xs text-text-primary outline-none border-b border-primary/40 py-0.5"
        />
      </div>
    );
  }

  if (mode === 'confirm-delete') {
    return (
      <div className="history-item flex flex-col gap-1.5 w-full px-3 py-2">
        <p className="text-xs text-text-primary">
          {t('history.deleteConfirmTitle')}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirmDelete}
            className="flex-1 px-2 py-1 rounded text-xs font-medium bg-status-error/15 text-status-error hover:bg-status-error/25 transition-colors duration-150 cursor-pointer"
          >
            {t('history.deleteAction')}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="flex-1 px-2 py-1 rounded text-xs font-medium bg-surface-elevated text-text-secondary hover:text-text-primary transition-colors duration-150 cursor-pointer"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="history-item group relative flex items-center gap-2 w-full"
      onContextMenu={(e) => {
        e.preventDefault();
        setMode('menu');
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-label={title}
        aria-current={isActive ? 'true' : undefined}
        className={`flex-1 min-w-0 flex flex-col gap-0.5 text-left px-3 py-2 rounded-lg transition-colors duration-150 cursor-pointer ${
          isActive
            ? 'bg-state-selected border-l-2 border-primary'
            : 'hover:bg-state-hover'
        }`}
      >
        <span
          className={`text-xs truncate leading-snug ${isActive ? 'text-primary font-medium' : 'text-text-primary'}`}
        >
          {title}
        </span>
        <span className="text-[10px] text-text-secondary leading-none">
          {timeLabel}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onDelete(conversation.id)}
        aria-label={t('history.delete')}
        className="shrink-0 mr-2 p-1 rounded text-text-secondary opacity-0 group-hover:opacity-100 hover:text-status-error hover:bg-status-error/10 transition-colors duration-150 cursor-pointer"
      >
        {DELETE_ICON}
      </button>

      {mode === 'menu' && (
        <>
          {/* Full-window backdrop: any click outside the menu dismisses it. */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40"
            onClick={() => setMode('idle')}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMode('idle');
            }}
          />
          <div className="absolute right-2 top-1 z-50 flex flex-col rounded-lg border border-surface-border bg-surface-base overflow-hidden">
            <button
              type="button"
              onClick={startRename}
              className="px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-elevated transition-colors duration-150 cursor-pointer"
            >
              {t('history.rename')}
            </button>
            <button
              type="button"
              onClick={() => setMode('confirm-delete')}
              className="px-3 py-1.5 text-left text-xs text-status-error hover:bg-status-error/10 transition-colors duration-150 cursor-pointer"
            >
              {t('history.deleteAction')}
            </button>
          </div>
        </>
      )}
    </div>
  );
});
