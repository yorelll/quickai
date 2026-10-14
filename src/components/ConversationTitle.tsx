import { useCallback, useState } from 'react';
import { useTranslation } from '../i18n';

interface ConversationTitleProps {
  /** Current conversation name. */
  title: string;
  /** Called with the trimmed new name when the user commits a rename. */
  onRename: (title: string) => void;
}

/**
 * Conversation name shown at the left of the chat header.
 *
 * Right-clicking the name swaps it for an inline text field. Enter or blur
 * commits the new name; Escape abandons the edit. Empty and unchanged drafts
 * are treated as no-ops so a stray click never issues a rename.
 */
export function ConversationTitle({ title, onRename }: ConversationTitleProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const startEditing = useCallback(() => {
    setDraft(title);
    setIsEditing(true);
  }, [title]);

  const commit = useCallback(() => {
    setIsEditing(false);
    const next = draft.trim();
    if (next.length > 0 && next !== title) onRename(next);
  }, [draft, title, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
      }
    },
    [commit],
  );

  if (isEditing) {
    return (
      <input
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        aria-label={t('conversation.renameLabel')}
        className="w-full min-w-0 bg-transparent text-xs text-text-primary outline-none border-b border-primary/40 px-1 py-0.5"
      />
    );
  }

  return (
    <button
      type="button"
      onContextMenu={(e) => {
        e.preventDefault();
        startEditing();
      }}
      title={t('conversation.rename')}
      aria-label={t('conversation.rename')}
      className="min-w-0 max-w-full truncate text-xs text-text-secondary hover:text-text-primary transition-colors duration-150 cursor-pointer px-1 py-0.5 rounded"
    >
      {title}
    </button>
  );
}
