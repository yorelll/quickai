/**
 * Skills editor for the AI tab.
 *
 * The backend owns storage and re-validates every save; this component owns
 * the editing operations (add / edit / delete / reorder) and mirrors the alias
 * rules so a bad edit is rejected before the round-trip. Path rules (a folder,
 * a non-text extension, a stray quote) are left to the backend, and its typed
 * rejection is localised here rather than shown as a generic failure. The
 * built-in assistant skill is listed but cannot be deleted.
 *
 * A short note under the heading explains what the enable toggle actually does
 * (item 8) — that an enabled skill joins the system prompt on every turn.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { Section, Toggle, ErrorDialog } from './index';
import {
  describeSkillError,
  isBuiltinSkill,
  newSkillId,
  parseSkillError,
  validateAlias,
  type AliasError,
  type Skill,
  type SkillSaveError,
} from '../skills';
import { useTranslation, type TranslationKey } from '../../i18n';
import styles from '../../styles/settings.module.css';

const ALIAS_ERROR_KEYS: Record<AliasError, TranslationKey> = {
  empty: 'settings.skills.errorAliasEmpty',
  whitespace: 'settings.skills.errorAliasWhitespace',
  duplicate: 'settings.skills.errorAliasDuplicate',
};

/**
 * The one error popup currently open: a failed initial load, or the last
 * `set_skills` rejection, typed or not. A single slot means one close control
 * dismisses whatever is showing and two failures never stack as two modals.
 */
type SkillFailure =
  | { kind: 'load' }
  | { kind: 'save'; error: SkillSaveError | 'unknown' };

export function SkillsSection() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [failure, setFailure] = useState<SkillFailure | null>(null);
  /** Entry being added or edited, or null when nothing is in edit mode. */
  const [draft, setDraft] = useState<Skill | null>(null);
  const [draftError, setDraftError] = useState<AliasError | null>(null);
  const dragFromRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<Skill[]>('get_skills')
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        if (cancelled) return;
        setSkills([]);
        setFailure({ kind: 'load' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: Skill[]): Promise<boolean> => {
    try {
      setSkills(await invoke<Skill[]>('set_skills', { skills: next }));
      setFailure(null);
      return true;
    } catch (e) {
      // The backend re-validates paths the frontend does not, so a rejection
      // here is normally a typed `SkillError`; localise it rather than showing
      // a generic message.
      setFailure({ kind: 'save', error: parseSkillError(e) ?? 'unknown' });
      return false;
    }
  }, []);

  /** Opens the native text-file picker and fills the draft's path with the choice. */
  const handleBrowsePath = useCallback(
    async (setValue: (next: string) => void) => {
      try {
        const picked = await invoke<string | null>('pick_file');
        if (picked) setValue(picked);
      } catch {
        // Picker unavailable: leave the field untouched.
      }
    },
    [],
  );

  if (skills === null) {
    return (
      <Section heading={t('settings.section.skills')}>
        <p className={styles.rowHelper}>{t('settings.skills.enableHint')}</p>
      </Section>
    );
  }

  const isAdding =
    draft !== null && !skills.some((skill) => skill.id === draft.id);

  const handleToggle = (skill: Skill, enabled: boolean) => {
    void persist(
      skills.map((entry) =>
        entry.id === skill.id ? { ...entry, enabled } : entry,
      ),
    );
  };

  const handleDelete = (skill: Skill) => {
    void persist(skills.filter((entry) => entry.id !== skill.id));
  };

  const handleMove = (index: number, delta: number) => {
    const next = [...skills];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    void persist(next);
  };

  const handleDrop = (targetIndex: number) => {
    const from = dragFromRef.current;
    dragFromRef.current = null;
    if (from === null || from === targetIndex) return;
    const next = [...skills];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    void persist(next);
  };

  const startAdd = () => {
    setDraftError(null);
    setDraft({ id: newSkillId(), alias: '', path: '', enabled: false });
  };

  const startEdit = (skill: Skill) => {
    setDraftError(null);
    setDraft({ ...skill });
  };

  const cancelDraft = () => {
    setDraft(null);
    setDraftError(null);
  };

  const commitDraft = (entry: Skill) => {
    const error = validateAlias(entry.alias, skills, entry.id);
    if (error !== null) {
      setDraftError(error);
      return;
    }
    const exists = skills.some((skill) => skill.id === entry.id);
    const next = exists
      ? skills.map((skill) => (skill.id === entry.id ? entry : skill))
      : [...skills, entry];
    void persist(next).then((saved) => {
      if (!saved) return;
      setDraft(null);
      setDraftError(null);
    });
  };

  const renderEditor = (entry: Skill) => (
    <div className={styles.skillEdit}>
      <div className={styles.skillEditFields}>
        <input
          className={styles.input}
          value={entry.alias}
          onChange={(e) => setDraft({ ...entry, alias: e.target.value })}
          placeholder={t('settings.skills.aliasPlaceholder')}
          aria-label={t('settings.skills.alias')}
          spellCheck={false}
        />
        <div className={styles.fieldWithButton}>
          <input
            className={styles.input}
            value={entry.path}
            onChange={(e) => setDraft({ ...entry, path: e.target.value })}
            placeholder={t('settings.skills.pathPlaceholder')}
            aria-label={t('settings.skills.path')}
            spellCheck={false}
          />
          <button
            type="button"
            className={`${styles.button} ${styles.buttonGhost}`}
            onClick={() =>
              void handleBrowsePath((next) =>
                setDraft({ ...entry, path: next }),
              )
            }
          >
            {t('settings.general.dataDirBrowse')}
          </button>
        </div>
        {draftError ? (
          <p className={styles.rowError} role="alert">
            {t(ALIAS_ERROR_KEYS[draftError])}
          </p>
        ) : null}
      </div>
      <div className={styles.skillActions}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonGhost}`}
          onClick={cancelDraft}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => commitDraft(entry)}
        >
          {t('settings.skills.save')}
        </button>
      </div>
    </div>
  );

  const renderView = (skill: Skill, index: number) => (
    <>
      <div className={styles.skillMain}>
        <span className={styles.skillAlias}>{skill.alias}</span>
        {isBuiltinSkill(skill) ? (
          <span className={styles.skillBadge}>
            {t('settings.skills.builtin')}
          </span>
        ) : null}
        <span className={styles.skillPath} title={skill.path}>
          {skill.path}
        </span>
      </div>
      <div className={styles.skillActions}>
        <Toggle
          checked={skill.enabled}
          onChange={(next) => handleToggle(skill, next)}
          ariaLabel={t('settings.skills.enabledFor', { alias: skill.alias })}
        />
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={t('settings.skills.edit')}
          onClick={() => startEdit(skill)}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={t('settings.skills.moveUp')}
          disabled={index === 0}
          onClick={() => handleMove(index, -1)}
        >
          <ChevronIcon direction="up" />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={t('settings.skills.moveDown')}
          disabled={index === skills.length - 1}
          onClick={() => handleMove(index, 1)}
        >
          <ChevronIcon direction="down" />
        </button>
        {isBuiltinSkill(skill) ? null : (
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={t('settings.skills.delete')}
            onClick={() => handleDelete(skill)}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </>
  );

  return (
    <Section heading={t('settings.section.skills')}>
      <p className={styles.rowHelper}>{t('settings.skills.enableHint')}</p>

      {skills.length === 0 && !isAdding ? (
        <p className={styles.rowHelper}>{t('settings.skills.empty')}</p>
      ) : (
        <ul className={styles.skillList}>
          {skills.map((skill, index) => {
            const editing = draft !== null && draft.id === skill.id;
            return (
              <li
                key={skill.id}
                className={styles.skillRow}
                draggable={!editing}
                onDragStart={() => {
                  dragFromRef.current = index;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
              >
                {editing && draft !== null
                  ? renderEditor(draft)
                  : renderView(skill, index)}
              </li>
            );
          })}
          {draft !== null && isAdding ? (
            <li className={styles.skillRow}>{renderEditor(draft)}</li>
          ) : null}
        </ul>
      )}

      <button
        type="button"
        className={`${styles.button} ${styles.buttonGhost}`}
        onClick={startAdd}
        disabled={draft !== null}
      >
        {t('settings.skills.add')}
      </button>

      {failure !== null ? (
        <ErrorDialog
          open
          title={t(
            failure.kind === 'load'
              ? 'settings.skills.loadErrorTitle'
              : 'settings.skills.saveErrorTitle',
          )}
          message={
            failure.kind === 'load'
              ? t('settings.skills.loadError')
              : failure.error === 'unknown'
                ? t('settings.skills.saveError')
                : describeSkillError(failure.error, t)
          }
          onClose={() => setFailure(null)}
        />
      ) : null}
    </Section>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={direction === 'up' ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
