import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentMode } from '../useAgentMode';
import { invoke } from '@tauri-apps/api/core';
import { emitTauriEvent } from '../../testUtils/mocks/tauri';

// These are the project's vitest-alias mocks from testUtils/mocks/tauri.ts
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const AGENT_EVENT = 'quickai://agent';

describe('useAgentMode', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it('should start in idle state', () => {
    const { result } = renderHook(() => useAgentMode());
    expect(result.current.isActive).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.lastAction).toBeNull();
    expect(result.current.lastResult).toBeNull();
    expect(result.current.reasoning).toBeNull();
    expect(result.current.summary).toBeNull();
    expect(result.current.pendingConfirmation).toBeNull();
  });

  it('should expose start and stop functions', () => {
    const { result } = renderHook(() => useAgentMode());
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.stop).toBe('function');
    expect(typeof result.current.confirmAction).toBe('function');
    expect(typeof result.current.rejectAction).toBe('function');
  });

  it('starts the agent with only the task text', async () => {
    const { result } = renderHook(() => useAgentMode());

    await act(async () => {
      await result.current.start('Open notepad');
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.status).toBe('capturing');
    expect(mockInvoke).toHaveBeenCalledWith('start_agent_mode', {
      task: 'Open notepad',
    });
  });

  it('should set error state when start_agent_mode rejects', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'start_agent_mode') return Promise.reject('boom');
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useAgentMode());

    await act(async () => {
      await result.current.start('Test');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.isActive).toBe(false);
    expect(result.current.lastResult).toBe('boom');
  });

  it('should transition to idle when stopped', async () => {
    const { result } = renderHook(() => useAgentMode());

    await act(async () => {
      await result.current.start('Test');
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(mockInvoke).toHaveBeenCalledWith('stop_agent_mode');
  });

  it('stop is safe before any start', async () => {
    const { result } = renderHook(() => useAgentMode());
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('idle');
  });

  it('should clear previous state on start', async () => {
    const { result } = renderHook(() => useAgentMode());

    await act(async () => {
      await result.current.start('Test task');
    });
    act(() => {
      emitTauriEvent(AGENT_EVENT, { kind: 'done', summary: 'finished' });
    });
    expect(result.current.summary).toBe('finished');

    await act(async () => {
      await result.current.start('New task');
    });

    expect(result.current.lastAction).toBeNull();
    expect(result.current.reasoning).toBeNull();
    expect(result.current.summary).toBeNull();
    expect(result.current.pendingConfirmation).toBeNull();
  });

  it('swallows stop_agent_mode failures', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'stop_agent_mode') return Promise.reject('nope');
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useAgentMode());
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('idle');
  });

  describe('agent events', () => {
    async function startedAgent() {
      const hook = renderHook(() => useAgentMode());
      await act(async () => {
        await hook.result.current.start('task');
      });
      return hook;
    }

    it('surfaces reasoning and moves to analyzing', async () => {
      const { result } = await startedAgent();
      await act(async () => {
        emitTauriEvent(AGENT_EVENT, {
          kind: 'reasoning',
          text: 'Looking at the screen',
        });
      });
      expect(result.current.reasoning).toBe('Looking at the screen');
      expect(result.current.status).toBe('analyzing');
      expect(result.current.isActive).toBe(true);
    });

    it('records an executed action and its result', async () => {
      const { result } = await startedAgent();
      await act(async () => {
        emitTauriEvent(AGENT_EVENT, {
          kind: 'action_executed',
          action: { type: 'click', x: 100, y: 200 },
          result: 'clicked',
        });
      });
      expect(result.current.lastAction).toEqual({
        type: 'click',
        x: 100,
        y: 200,
      });
      expect(result.current.lastResult).toBe('clicked');
      expect(result.current.status).toBe('executing');
    });

    it('records a confirmation request with its structured action', async () => {
      const { result } = await startedAgent();
      await act(async () => {
        emitTauriEvent(AGENT_EVENT, {
          kind: 'confirmation_required',
          action: { type: 'launch', app: 'notepad' },
        });
      });
      expect(result.current.pendingConfirmation).toEqual({
        type: 'launch',
        app: 'notepad',
      });
      expect(result.current.status).toBe('waiting_confirmation');
    });

    it('handles error events', async () => {
      const { result } = await startedAgent();
      await act(async () => {
        emitTauriEvent(AGENT_EVENT, {
          kind: 'error',
          code: 'rate_limited',
          message: 'slow down',
        });
      });
      expect(result.current.status).toBe('error');
      expect(result.current.isActive).toBe(false);
      expect(result.current.lastResult).toBe('slow down');
    });

    it('surfaces the model summary and finishes', async () => {
      const { result } = await startedAgent();
      await act(async () => {
        emitTauriEvent(AGENT_EVENT, {
          kind: 'done',
          summary: 'Opened Notepad and typed the note.',
        });
      });
      expect(result.current.summary).toBe('Opened Notepad and typed the note.');
      expect(result.current.status).toBe('done');
      expect(result.current.isActive).toBe(false);
    });
  });

  describe('confirm / reject', () => {
    it('confirms the pending action without an id and clears it', async () => {
      const { result } = renderHook(() => useAgentMode());
      await act(async () => {
        await result.current.confirmAction();
      });
      expect(mockInvoke).toHaveBeenCalledWith('confirm_agent_action', {
        actionId: null,
      });
      expect(result.current.pendingConfirmation).toBeNull();
    });

    it('rejects the pending action without an id and clears it', async () => {
      const { result } = renderHook(() => useAgentMode());
      await act(async () => {
        await result.current.rejectAction();
      });
      expect(mockInvoke).toHaveBeenCalledWith('reject_agent_action', {
        actionId: null,
      });
      expect(result.current.pendingConfirmation).toBeNull();
    });

    it('swallows confirm failures', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'confirm_agent_action') return Promise.reject('no');
        return Promise.resolve(undefined);
      });
      const { result } = renderHook(() => useAgentMode());
      await act(async () => {
        await result.current.confirmAction();
      });
      expect(result.current.pendingConfirmation).toBeNull();
    });

    it('swallows reject failures', async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'reject_agent_action') return Promise.reject('no');
        return Promise.resolve(undefined);
      });
      const { result } = renderHook(() => useAgentMode());
      await act(async () => {
        await result.current.rejectAction();
      });
      expect(result.current.pendingConfirmation).toBeNull();
    });
  });

  describe('dismiss', () => {
    it('clears a finished run so the panel can be closed', async () => {
      mockInvoke.mockResolvedValue(undefined);
      const { result } = renderHook(() => useAgentMode());

      await act(async () => {
        await result.current.start('open notepad');
      });
      await act(async () => {
        emitTauriEvent(AGENT_EVENT, { kind: 'done', summary: 'All done.' });
      });
      expect(result.current.status).toBe('done');
      expect(result.current.summary).toBe('All done.');

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.summary).toBeNull();
      expect(result.current.lastAction).toBeNull();
      expect(result.current.lastResult).toBeNull();
      expect(result.current.reasoning).toBeNull();
      expect(result.current.pendingConfirmation).toBeNull();
    });

    it('clears a pending confirmation', async () => {
      mockInvoke.mockResolvedValue(undefined);
      const { result } = renderHook(() => useAgentMode());

      await act(async () => {
        await result.current.start('task');
      });
      await act(async () => {
        emitTauriEvent(AGENT_EVENT, {
          kind: 'confirmation_required',
          action: { type: 'click', x: 1, y: 2 },
        });
      });
      expect(result.current.pendingConfirmation).not.toBeNull();

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.pendingConfirmation).toBeNull();
    });
  });
});
