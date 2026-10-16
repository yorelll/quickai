import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSkills } from '../useSkills';
import { invoke } from '../../testUtils/mocks/tauri';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const SKILLS = [
  { id: 's1', alias: 'assistant', path: '/a.md', enabled: true },
  { id: 's2', alias: 'translate', path: '/b.md', enabled: false },
];

describe('useSkills', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('loads the configured skills on mount', async () => {
    mockInvoke.mockResolvedValue(SKILLS);

    const { result } = renderHook(() => useSkills());
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('get_skills');
    expect(result.current.skills).toEqual(SKILLS);
  });

  it('falls back to an empty list when the backend returns a non-array', async () => {
    mockInvoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSkills());
    await act(async () => {});

    expect(result.current.skills).toEqual([]);
  });

  it('falls back to an empty list when the read fails', async () => {
    mockInvoke.mockRejectedValue(new Error('backend down'));

    const { result } = renderHook(() => useSkills());
    await act(async () => {});

    expect(result.current.skills).toEqual([]);
  });

  it('re-reads the list when refresh is called', async () => {
    mockInvoke.mockResolvedValue([]);

    const { result } = renderHook(() => useSkills());
    await act(async () => {});
    expect(result.current.skills).toEqual([]);

    mockInvoke.mockResolvedValue(SKILLS);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.skills).toEqual(SKILLS);
  });
});
