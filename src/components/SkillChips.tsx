import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '../i18n';

interface SkillChipsProps {
  /** Aliases of the skills selected for the current message. */
  skills: string[];
  /** Called with the alias when its remove button is clicked. */
  onRemove: (alias: string) => void;
}

/**
 * Renders the skills selected for the current message as removable chips,
 * mirroring the attached-image row so the two read as one system. Removing a
 * chip makes the skill available to pick again from `/add`.
 */
export function SkillChips({ skills, onRemove }: SkillChipsProps) {
  const { t } = useTranslation();
  if (skills.length === 0) return null;

  return (
    <div
      className="flex gap-2 flex-wrap"
      role="list"
      aria-label={t('ask.selectedSkills')}
    >
      <AnimatePresence>
        {skills.map((alias) => (
          <motion.div
            key={alias}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-surface-elevated border border-surface-border"
            role="listitem"
          >
            <span className="text-xs text-text-primary">{alias}</span>
            <button
              type="button"
              onClick={() => onRemove(alias)}
              aria-label={t('ask.removeSkill', { alias })}
              className="w-4 h-4 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-primary/15 transition-colors cursor-pointer"
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M1 1L7 7M7 1L1 7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
