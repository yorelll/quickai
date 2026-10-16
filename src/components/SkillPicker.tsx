import type { Skill } from '../types/skill';
import { useTranslation } from '../i18n';

interface SkillPickerProps {
  /** Skills to list, in their persisted order (enabled ones included). */
  skills: Skill[];
  /** Index of the highlighted row. */
  highlightedIndex: number;
  /** Called with the skill's alias when an addable row is clicked. */
  onSelect: (alias: string) => void;
}

/**
 * `/add` skill picker.
 *
 * Mirrors the slash-command popover: one row per skill, the highlighted row
 * marked, and a Ctrl+Enter hint explaining that it adds the skill without
 * leaving the picker. Enabled skills are listed too, but dimmed and inert —
 * they already ride the system prompt every turn, so adding one would append
 * its text twice. Purely presentational: the parent (AskBarView) owns the
 * highlight and the keyboard handling.
 */
export function SkillPicker({
  skills,
  highlightedIndex,
  onSelect,
}: SkillPickerProps) {
  const { t } = useTranslation();
  return (
    <div
      className="mb-1 rounded-lg border border-surface-border bg-surface-base overflow-hidden"
      role="listbox"
      aria-label={t('ask.skillPickerLabel')}
    >
      <div className="px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold tracking-widest text-text-secondary uppercase">
          {t('ask.skills')}
        </span>
      </div>

      {skills.length === 0 ? (
        <div className="px-3 pb-2 text-sm text-text-secondary italic">
          {t('ask.noSkills')}
        </div>
      ) : (
        <ul className="pb-1 max-h-[112px] overflow-y-auto" role="presentation">
          {skills.map((skill, index) => {
            const isHighlighted = index === highlightedIndex;
            const isEnabled = skill.enabled;
            return (
              <li
                key={skill.id}
                role="option"
                aria-selected={isHighlighted && !isEnabled}
                aria-disabled={isEnabled || undefined}
                className={`flex items-center gap-2.5 px-3 py-1.5 select-none transition-colors duration-100 ${
                  isEnabled
                    ? `opacity-50 cursor-default ${
                        // A dim marker only: arrowing onto an inert row must
                        // still show where the highlight is.
                        isHighlighted ? 'bg-surface-elevated/40' : ''
                      }`
                    : `cursor-pointer ${
                        isHighlighted
                          ? 'bg-surface-elevated text-text-primary'
                          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                      }`
                }`}
                onMouseDown={(e) => {
                  // mousedown + preventDefault so the textarea keeps focus.
                  e.preventDefault();
                  if (isEnabled) return;
                  onSelect(skill.alias);
                }}
              >
                <span
                  className={`text-sm font-medium shrink-0 ${isEnabled ? 'text-text-secondary' : 'text-text-primary'}`}
                >
                  {skill.alias}
                </span>

                {isEnabled ? (
                  <span className="shrink-0 ml-auto text-[10px] font-medium text-text-secondary border border-surface-border rounded px-1 py-0.5 leading-none">
                    {t('ask.skillEnabledHint')}
                  </span>
                ) : (
                  isHighlighted && (
                    <span className="shrink-0 ml-auto text-[10px] font-medium text-text-secondary border border-surface-border rounded px-1 py-0.5 leading-none">
                      {t('ask.skillAddHint')}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
