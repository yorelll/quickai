import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Skill } from '../types/skill';

interface UseSkillsReturn {
  /** Skills configured in Settings, in their persisted order. */
  skills: Skill[];
  /** Re-reads the skill list from the backend. */
  refresh: () => Promise<void>;
}

/**
 * Loads the configured skills. The overlay uses the subset with
 * `enabled: false` for the `/add` picker (enabled skills already ride the
 * system prompt); the list lives in the backend (`get_skills`), so it is
 * re-read on demand and a skill added in Settings shows up without restarting.
 */
export function useSkills(): UseSkillsReturn {
  const [skills, setSkills] = useState<Skill[]>([]);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<Skill[]>('get_skills');
      setSkills(Array.isArray(result) ? result : []);
    } catch {
      // A failed read leaves the picker empty rather than breaking the bar.
      setSkills([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { skills, refresh };
}
