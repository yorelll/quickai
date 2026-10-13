import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChat } from '../useChat';
import type { Message } from '../../types/chat';
import {
  invoke,
  enableChannelCapture,
  getLastChannel,
} from '../../testUtils/mocks/tauri';
import type { Channel } from '../../testUtils/mocks/tauri';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function channel(): Channel {
  const ch = getLastChannel();
  if (!ch) throw new Error('no channel captured');
  return ch;
}

describe('useChat', () => {
  beforeEach(() => {
    mockInvoke.mockClear();
    enableChannelCapture();
  });

  it('starts with an empty thread', () => {
    const { result } = renderHook(() => useChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isGenerating).toBe(false);
  });

  it('adds a user message and an empty assistant placeholder', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask('hello world');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'hello world',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: '',
    });
    expect(result.current.isGenerating).toBe(true);
  });

  it('sends the INTERFACE call shape to the ask command', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask(
        'hi',
        'quoted',
        ['/tmp/a.png'],
        true,
        'override',
      );
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'ask',
      expect.objectContaining({
        query: 'hi',
        context: 'quoted',
        images: ['/tmp/a.png'],
        think: true,
        promptOverride: 'override',
        onEvent: expect.anything(),
      }),
    );
  });

  it('normalizes optional arguments to null', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask('hi');
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'ask',
      expect.objectContaining({
        context: null,
        images: null,
        think: false,
        promptOverride: null,
      }),
    );
  });

  it('ignores an empty submission with no images', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask('   ');
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('allows an image-only submission', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask('', undefined, ['/tmp/a.png']);
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'ask',
      expect.objectContaining({ query: '', images: ['/tmp/a.png'] }),
    );
  });

  it('does not start a second generation while one is active', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask('first');
    });
    await act(async () => {
      await result.current.ask('second');
    });

    expect(result.current.messages).toHaveLength(2);
  });

  it('streams tokens into the assistant message', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({ type: 'Token', data: 'Hel' });
      channel().onmessage({ type: 'Token', data: 'lo' });
    });

    expect(result.current.messages[1].content).toBe('Hello');
  });

  it('streams thinking tokens separately', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({ type: 'ThinkingToken', data: 'pon' });
      channel().onmessage({ type: 'ThinkingToken', data: 'der' });
    });

    expect(result.current.messages[1].thinkingContent).toBe('ponder');
  });

  it('finalizes the turn on Done and notifies the caller', async () => {
    const onTurnComplete = vi.fn();
    const { result } = renderHook(() => useChat(onTurnComplete));
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({ type: 'Token', data: 'answer' });
      channel().onmessage({ type: 'ThinkingToken', data: 'reason' });
      channel().onmessage({ type: 'Done' });
    });

    expect(result.current.isGenerating).toBe(false);
    expect(onTurnComplete).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'hi' }),
      expect.objectContaining({
        role: 'assistant',
        content: 'answer',
        thinkingContent: 'reason',
      }),
    );
  });

  it('omits thinkingContent on Done when no reasoning was streamed', async () => {
    const onTurnComplete = vi.fn();
    const { result } = renderHook(() => useChat(onTurnComplete));
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({ type: 'Token', data: 'answer' });
      channel().onmessage({ type: 'Done' });
    });

    expect(onTurnComplete.mock.calls[0][1].thinkingContent).toBeUndefined();
  });

  it('drops the placeholder when cancelled with no content', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({ type: 'Cancelled' });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.isGenerating).toBe(false);
  });

  it('keeps partial content when cancelled', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({ type: 'Token', data: 'par' });
      channel().onmessage({ type: 'Cancelled' });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toBe('par');
  });

  it('keeps partial thinking when cancelled', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({ type: 'ThinkingToken', data: 'think' });
      channel().onmessage({ type: 'Cancelled' });
    });

    expect(result.current.messages).toHaveLength(2);
  });

  it('attaches an ApiError from the Error chunk', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });

    act(() => {
      channel().onmessage({
        type: 'Error',
        data: { code: 'rate_limited', message: 'slow down' },
      });
    });

    expect(result.current.messages[1].error).toEqual({
      code: 'rate_limited',
      message: 'slow down',
    });
    expect(result.current.isGenerating).toBe(false);
  });

  it('appends a network error message when ask rejects with an Error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask('hi');
    });

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.error).toEqual({ code: 'network', message: 'ipc down' });
    expect(result.current.isGenerating).toBe(false);
  });

  it('stringifies non-Error rejections', async () => {
    mockInvoke.mockRejectedValueOnce('plain string failure');
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.ask('hi');
    });

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.error).toEqual({
      code: 'network',
      message: 'plain string failure',
    });
  });

  it('cancels the active generation', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });

    await act(async () => {
      await result.current.cancel();
    });

    expect(mockInvoke).toHaveBeenCalledWith('cancel_generation');
  });

  it('cancel is a no-op when idle', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.cancel();
    });
    expect(mockInvoke).not.toHaveBeenCalledWith('cancel_generation');
  });

  it('reset clears the thread and tells the backend', async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.ask('hi');
    });
    act(() => {
      channel().onmessage({ type: 'Done' });
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isGenerating).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('reset_conversation');
  });

  it('loadMessages replaces the thread', () => {
    const { result } = renderHook(() => useChat());
    const loaded: Message[] = [
      { id: '1', role: 'user', content: 'old' },
      { id: '2', role: 'assistant', content: 'reply' },
    ];

    act(() => {
      result.current.loadMessages(loaded);
    });

    expect(result.current.messages).toEqual(loaded);
    expect(result.current.isGenerating).toBe(false);
  });
});
