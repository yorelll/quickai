import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentAction, AgentEvent, AgentNotice } from '../types/agent';

export type AgentStatus =
  | 'idle'
  | 'capturing'
  | 'analyzing'
  | 'executing'
  | 'waiting_confirmation'
  | 'done'
  | 'error';

export type { AgentAction, AgentEvent, AgentNotice };

interface UseAgentModeReturn {
  isActive: boolean;
  status: AgentStatus;
  /** Structured action currently being executed (localized at render time). */
  lastAction: AgentAction | null;
  /** Model-produced result text for the last executed action. */
  lastResult: string | null;
  /** Model-produced reasoning text, shown while analyzing. */
  reasoning: string | null;
  /** Model-produced closing summary, shown when the run finishes. */
  summary: string | null;
  /**
   * A non-fatal diagnostic raised mid-run (e.g. an unreadable selected skill).
   * Unlike a terminal error it never ends the run, so the panel stays visible.
   */
  notice: AgentNotice | null;
  /** Structured action awaiting user confirmation. */
  pendingConfirmation: AgentAction | null;
  /**
   * Starts a run. `skills` names the skills to append to the agent's prompt
   * for this run, mirroring the chat `ask` parameter.
   */
  start: (task: string, skills?: string[]) => Promise<void>;
  stop: () => Promise<void>;
  confirmAction: () => Promise<void>;
  rejectAction: () => Promise<void>;
  /** Clears a finished/failed run so the panel disappears. */
  dismiss: () => void;
}

/**
 * Drives cloud agent mode (`/do`). The provider, model and base URL come from
 * the `[agent]` config section on the Rust side, so the frontend only sends the
 * task text and reacts to the streamed [`AgentEvent`]s. Status is derived from
 * those events — the backend does not emit a separate status stream.
 */
export function useAgentMode(): UseAgentModeReturn {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [lastAction, setLastAction] = useState<AgentAction | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [notice, setNotice] = useState<AgentNotice | null>(null);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<AgentAction | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const start = useCallback(async (task: string, skills?: string[]) => {
    setIsActive(true);
    setStatus('capturing');
    setLastAction(null);
    setLastResult(null);
    setReasoning(null);
    setSummary(null);
    setNotice(null);
    setPendingConfirmation(null);

    // Listen for agent events.
    const unlisten = await listen<AgentEvent>('quickai://agent', (event) => {
      const payload = event.payload;

      switch (payload.kind) {
        case 'reasoning': {
          setReasoning(payload.text);
          setStatus('analyzing');
          break;
        }
        case 'action_executed': {
          setLastAction(payload.action);
          setLastResult(payload.result);
          setStatus('executing');
          break;
        }
        case 'confirmation_required': {
          setPendingConfirmation(payload.action);
          setStatus('waiting_confirmation');
          break;
        }
        case 'error': {
          // `skill_unreadable` is a non-fatal notice: the backend keeps the
          // loop running, so the status must not flip to `error` and the run
          // must not be marked inactive — doing so would flash an error and
          // then hide the agent panel for the rest of the run.
          if (payload.code === 'skill_unreadable') {
            setNotice({ code: payload.code, message: payload.message });
            break;
          }
          setLastResult(payload.message);
          setStatus('error');
          setIsActive(false);
          break;
        }
        case 'done': {
          setSummary(payload.summary);
          setStatus('done');
          setIsActive(false);
          break;
        }
      }
    });

    unlistenRef.current = unlisten;

    try {
      await invoke('start_agent_mode', {
        task,
        skills: skills && skills.length > 0 ? skills : null,
      });
    } catch (e) {
      console.error('Failed to start agent mode:', e);
      setStatus('error');
      setIsActive(false);
      setLastResult(String(e));
      unlisten();
      unlistenRef.current = null;
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await invoke('stop_agent_mode');
    } catch (e) {
      console.error('Failed to stop agent mode:', e);
    }
    setIsActive(false);
    setStatus('idle');
    setNotice(null);
    setPendingConfirmation(null);
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  /** Confirms the single pending action. The backend takes an optional id. */
  const confirmAction = useCallback(async () => {
    try {
      await invoke('confirm_agent_action', { actionId: null });
      setPendingConfirmation(null);
    } catch (e) {
      console.error('Failed to confirm action:', e);
    }
  }, []);

  /** Rejects the single pending action. The backend takes an optional id. */
  const rejectAction = useCallback(async () => {
    try {
      await invoke('reject_agent_action', { actionId: null });
      setPendingConfirmation(null);
    } catch (e) {
      console.error('Failed to reject action:', e);
    }
  }, []);

  /**
   * Clears the panel after a run finished or failed. Terminal state is a
   * display-only concern, so this only resets the local status/fields.
   */
  const dismiss = useCallback(() => {
    setStatus('idle');
    setLastAction(null);
    setLastResult(null);
    setReasoning(null);
    setSummary(null);
    setNotice(null);
    setPendingConfirmation(null);
  }, []);

  return {
    isActive,
    status,
    lastAction,
    lastResult,
    reasoning,
    summary,
    notice,
    pendingConfirmation,
    start,
    stop,
    confirmAction,
    rejectAction,
    dismiss,
  };
}
