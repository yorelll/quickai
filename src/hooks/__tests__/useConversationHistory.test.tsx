import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useConversationHistory } from '../useConversationHistory';
import { invoke } from '../../testUtils/mocks/tauri';
import type { Message } from '../../types/chat';

const MESSAGES: Message[] = [
  { id: 'u1', role: 'user', content: 'Hello', quotedText: undefined },
  { id: 'a1', role: 'assistant', content: 'Hi there' },
];

const MODEL = 'gemini-3-flash-preview';

describe('useConversationHistory', () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with isSaved false and conversationId null', () => {
    const { result } = renderHook(() => useConversationHistory());
    expect(result.current.isSaved).toBe(false);
    expect(result.current.conversationId).toBeNull();
  });

  it('save() invokes save_conversation with correct payload', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined); // generate_title

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    expect(invoke).toHaveBeenCalledWith('save_conversation', {
      messages: [
        {
          role: 'user',
          content: 'Hello',
          quoted_text: null,
          image_paths: null,
          thinking_content: null,
        },
        {
          role: 'assistant',
          content: 'Hi there',
          quoted_text: null,
          image_paths: null,
          thinking_content: null,
        },
      ],
      model: MODEL,
    });
  });

  it('save() sets isSaved to true and stores conversationId', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    expect(result.current.isSaved).toBe(true);
    expect(result.current.conversationId).toBe('conv-123');
  });

  it('save() fires generate_title as fire-and-forget after saving', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    expect(invoke).toHaveBeenCalledWith('generate_title', {
      conversationId: 'conv-123',
      messages: [
        {
          role: 'user',
          content: 'Hello',
          quoted_text: null,
          image_paths: null,
          thinking_content: null,
        },
        {
          role: 'assistant',
          content: 'Hi there',
          quoted_text: null,
          image_paths: null,
          thinking_content: null,
        },
      ],
    });
  });

  it('save() is a no-op when already saved', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    invoke.mockClear();

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it('persistTurn() is a no-op when not saved', async () => {
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.persistTurn(MESSAGES[0], MESSAGES[1]);
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it('persistTurn() invokes persist_message for both messages when saved', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    invoke.mockClear();

    const userMsg: Message = {
      id: 'u2',
      role: 'user',
      content: 'Follow up',
      quotedText: 'ctx',
    };
    const assistantMsg: Message = {
      id: 'a2',
      role: 'assistant',
      content: 'Reply',
    };

    await act(async () => {
      await result.current.persistTurn(userMsg, assistantMsg);
    });

    expect(invoke).toHaveBeenCalledWith('persist_message', {
      conversationId: 'conv-123',
      role: 'user',
      content: 'Follow up',
      quotedText: 'ctx',
      imagePaths: null,
      thinkingContent: null,
    });
    expect(invoke).toHaveBeenCalledWith('persist_message', {
      conversationId: 'conv-123',
      role: 'assistant',
      content: 'Reply',
      quotedText: null,
      imagePaths: null,
      thinkingContent: null,
    });
  });

  it('persistTurn() passes null for undefined quotedText on userMsg', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-999' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    invoke.mockClear();

    // userMsg has NO quotedText — should map to null
    const userMsg: Message = {
      id: 'u3',
      role: 'user',
      content: 'No context',
      quotedText: undefined,
    };
    const assistantMsg: Message = {
      id: 'a3',
      role: 'assistant',
      content: 'Sure',
      quotedText: 'assistant ctx',
    };

    await act(async () => {
      await result.current.persistTurn(userMsg, assistantMsg);
    });

    expect(invoke).toHaveBeenCalledWith(
      'persist_message',
      expect.objectContaining({
        quotedText: null, // undefined → null
        thinkingContent: null,
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      'persist_message',
      expect.objectContaining({
        quotedText: 'assistant ctx',
        thinkingContent: null,
      }),
    );
  });

  it('loadConversation() invokes load_conversation and returns mapped Messages', async () => {
    invoke.mockResolvedValueOnce([
      {
        id: 'm1',
        role: 'user',
        content: 'Saved question',
        quoted_text: null,
        image_paths: null,
        thinking_content: null,
        created_at: 1,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Saved answer',
        quoted_text: 'ctx',
        image_paths: null,
        thinking_content: null,
        created_at: 2,
      },
    ]);

    const { result } = renderHook(() => useConversationHistory());
    let loaded: Message[] = [];

    await act(async () => {
      loaded = await result.current.loadConversation('conv-456');
    });

    expect(invoke).toHaveBeenCalledWith('load_conversation', {
      conversationId: 'conv-456',
    });

    expect(loaded).toEqual([
      {
        id: 'm1',
        role: 'user',
        content: 'Saved question',
        quotedText: undefined,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Saved answer',
        quotedText: 'ctx',
      },
    ]);
  });

  it('loadConversation() restores imagePaths from persisted JSON', async () => {
    invoke.mockResolvedValueOnce([
      {
        id: 'm1',
        role: 'user',
        content: 'Look at this',
        quoted_text: null,
        image_paths: '["/images/a.jpg","/images/b.jpg"]',
        thinking_content: null,
        created_at: 1,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'I see',
        quoted_text: null,
        image_paths: null,
        thinking_content: null,
        created_at: 2,
      },
    ]);

    const { result } = renderHook(() => useConversationHistory());
    let loaded: Message[] = [];

    await act(async () => {
      loaded = await result.current.loadConversation('conv-img');
    });

    expect(loaded[0].imagePaths).toEqual(['/images/a.jpg', '/images/b.jpg']);
    expect(loaded[1].imagePaths).toBeUndefined();
  });

  it('loadConversation() sets conversationId to the loaded id', async () => {
    invoke.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.loadConversation('conv-789');
    });

    expect(result.current.conversationId).toBe('conv-789');
    expect(result.current.isSaved).toBe(true);
  });

  it('deleteConversation() invokes delete_conversation with correct id', async () => {
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.deleteConversation('conv-123');
    });

    expect(invoke).toHaveBeenCalledWith('delete_conversation', {
      conversationId: 'conv-123',
    });
  });

  it('listConversations() invokes list_conversations without search', async () => {
    invoke.mockResolvedValue([]);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.listConversations();
    });

    expect(invoke).toHaveBeenCalledWith('list_conversations', { search: null });
  });

  it('listConversations() invokes list_conversations with search term', async () => {
    invoke.mockResolvedValue([]);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.listConversations('react');
    });

    expect(invoke).toHaveBeenCalledWith('list_conversations', {
      search: 'react',
    });
  });

  it('persistTurn() passes thinkingContent for assistant messages', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    invoke.mockClear();

    const userMsg: Message = {
      id: 'u4',
      role: 'user',
      content: 'Think about this',
    };
    const assistantMsg: Message = {
      id: 'a4',
      role: 'assistant',
      content: 'Here is my answer',
      thinkingContent: 'Let me reason step by step',
    };

    await act(async () => {
      await result.current.persistTurn(userMsg, assistantMsg);
    });

    expect(invoke).toHaveBeenCalledWith('persist_message', {
      conversationId: 'conv-123',
      role: 'assistant',
      content: 'Here is my answer',
      quotedText: null,
      imagePaths: null,
      thinkingContent: 'Let me reason step by step',
    });
  });

  it('save() includes thinking_content in payload', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-think' });
    invoke.mockResolvedValue(undefined);

    const messagesWithThinking: Message[] = [
      { id: 'u1', role: 'user', content: 'Think hard' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Answer',
        thinkingContent: 'Deep thoughts',
      },
    ];

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(messagesWithThinking, MODEL);
    });

    expect(invoke).toHaveBeenCalledWith('save_conversation', {
      messages: [
        {
          role: 'user',
          content: 'Think hard',
          quoted_text: null,
          image_paths: null,
          thinking_content: null,
        },
        {
          role: 'assistant',
          content: 'Answer',
          quoted_text: null,
          image_paths: null,
          thinking_content: 'Deep thoughts',
        },
      ],
      model: MODEL,
    });
  });

  it('loadConversation() restores thinkingContent from persisted data', async () => {
    invoke.mockResolvedValueOnce([
      {
        id: 'm1',
        role: 'user',
        content: 'Question',
        quoted_text: null,
        image_paths: null,
        thinking_content: null,
        created_at: 1,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Answer',
        quoted_text: null,
        image_paths: null,
        thinking_content: 'I thought about it',
        created_at: 2,
      },
    ]);

    const { result } = renderHook(() => useConversationHistory());
    let loaded: Message[] = [];

    await act(async () => {
      loaded = await result.current.loadConversation('conv-think');
    });

    expect(loaded[0].thinkingContent).toBeUndefined();
    expect(loaded[1].thinkingContent).toBe('I thought about it');
  });

  it('reset() clears conversationId and isSaved', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    expect(result.current.isSaved).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isSaved).toBe(false);
    expect(result.current.conversationId).toBeNull();
  });

  it('unsave() calls delete_conversation and clears isSaved', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    expect(result.current.isSaved).toBe(true);

    invoke.mockClear();

    await act(async () => {
      await result.current.unsave();
    });

    expect(invoke).toHaveBeenCalledWith('delete_conversation', {
      conversationId: 'conv-123',
    });
    expect(result.current.isSaved).toBe(false);
    expect(result.current.conversationId).toBeNull();
  });

  it('unsave() is a no-op when not saved', async () => {
    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.unsave();
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it('reset() does not call reset_conversation (caller is responsible)', async () => {
    invoke.mockResolvedValueOnce({ conversation_id: 'conv-123' });
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });

    invoke.mockClear();

    act(() => {
      result.current.reset();
    });

    expect(invoke).not.toHaveBeenCalledWith(
      'reset_conversation',
      expect.anything(),
    );
  });

  // ─── Title tracking (item 12) ─────────────────────────────────────────────

  /** Routes commands to canned responses for the title-tracking tests. */
  function mockHistory(overrides: {
    saveId?: string;
    list?: () => Promise<unknown>;
  }) {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'save_conversation') {
        return { conversation_id: overrides.saveId ?? 'conv-1' };
      }
      if (cmd === 'list_conversations' && overrides.list) {
        return overrides.list();
      }
      return undefined;
    });
  }

  it('save() adopts the stored title for the active conversation', async () => {
    mockHistory({
      list: async () => [
        {
          id: 'conv-1',
          title: 'Stored title',
          model: MODEL,
          updated_at: 0,
          message_count: 2,
        },
      ],
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});

    expect(result.current.conversationTitle).toBe('Stored title');
  });

  it('save() re-reads the title after the AI title delay', async () => {
    let reads = 0;
    mockHistory({
      list: async () => {
        reads += 1;
        return [
          {
            id: 'conv-1',
            title: reads === 1 ? 'Placeholder' : 'AI title',
            model: MODEL,
            updated_at: 0,
            message_count: 2,
          },
        ];
      },
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});
    expect(result.current.conversationTitle).toBe('Placeholder');

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(result.current.conversationTitle).toBe('AI title');
  });

  it('save() leaves the title untouched when the refresh fails', async () => {
    mockHistory({
      list: async () => {
        throw new Error('database unavailable');
      },
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});

    expect(result.current.conversationTitle).toBeNull();
  });

  it('save() clears the title when the saved row has none', async () => {
    mockHistory({
      list: async () => [
        {
          id: 'conv-1',
          title: null,
          model: MODEL,
          updated_at: 0,
          message_count: 2,
        },
      ],
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});

    expect(result.current.conversationTitle).toBeNull();
  });

  it('save() survives a failed title generation', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'save_conversation') return { conversation_id: 'conv-1' };
      if (cmd === 'generate_title') throw new Error('provider down');
      return undefined;
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});

    // The save itself succeeded; only the background title was lost.
    expect(result.current.conversationId).toBe('conv-1');
    expect(result.current.isSaved).toBe(true);
  });

  it('loadConversation() refreshes the title for the loaded conversation', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_conversation') return [];
      if (cmd === 'list_conversations') {
        return [
          {
            id: 'conv-9',
            title: 'Loaded title',
            model: MODEL,
            updated_at: 0,
            message_count: 0,
          },
        ];
      }
      return undefined;
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.loadConversation('conv-9');
    });
    await act(async () => {});

    expect(result.current.conversationTitle).toBe('Loaded title');
  });

  it('renameConversation() renames the active conversation and updates the header', async () => {
    mockHistory({
      list: async () => [
        {
          id: 'conv-1',
          title: 'Old name',
          model: MODEL,
          updated_at: 0,
          message_count: 2,
        },
      ],
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});

    await act(async () => {
      await result.current.renameConversation('conv-1', 'New name');
    });

    expect(invoke).toHaveBeenCalledWith('rename_conversation', {
      conversationId: 'conv-1',
      title: 'New name',
    });
    expect(result.current.conversationTitle).toBe('New name');
  });

  it('renameConversation() leaves the header alone for another conversation', async () => {
    invoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.renameConversation('someone-else', 'New name');
    });

    expect(invoke).toHaveBeenCalledWith('rename_conversation', {
      conversationId: 'someone-else',
      title: 'New name',
    });
    expect(result.current.conversationTitle).toBeNull();
  });

  it('reset() clears the title and any pending refresh', async () => {
    mockHistory({
      list: async () => [
        {
          id: 'conv-1',
          title: 'Title',
          model: MODEL,
          updated_at: 0,
          message_count: 2,
        },
      ],
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});
    expect(result.current.conversationTitle).toBe('Title');

    act(() => {
      result.current.reset();
    });

    expect(result.current.conversationTitle).toBeNull();
  });

  it('reset() is safe when no title refresh is pending', () => {
    const { result } = renderHook(() => useConversationHistory());

    act(() => {
      result.current.reset();
    });

    expect(result.current.conversationTitle).toBeNull();
  });

  it('keeps a manual rename when the delayed AI title lands later', async () => {
    mockHistory({
      list: async () => [
        {
          id: 'conv-1',
          title: 'AI title',
          model: MODEL,
          updated_at: 0,
          message_count: 2,
        },
      ],
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});
    expect(result.current.conversationTitle).toBe('AI title');

    await act(async () => {
      await result.current.renameConversation('conv-1', 'My name');
    });
    expect(result.current.conversationTitle).toBe('My name');

    // The delayed refresh fires, but a manual name always wins.
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.conversationTitle).toBe('My name');
  });

  it('does not adopt the previous conversation title after loading another', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'save_conversation') return { conversation_id: 'conv-a' };
      if (cmd === 'load_conversation') return [];
      if (cmd === 'list_conversations') {
        return [
          {
            id: 'conv-a',
            title: 'A title',
            model: MODEL,
            updated_at: 0,
            message_count: 1,
          },
        ];
      }
      return undefined;
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {});
    expect(result.current.conversationTitle).toBe('A title');

    await act(async () => {
      await result.current.loadConversation('conv-b');
    });
    await act(async () => {});

    // No stored row for conv-b: the header clears rather than keeping A's name.
    expect(result.current.conversationTitle).toBeNull();

    // The refresh queued for conv-a was cancelled by the load.
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.conversationTitle).toBeNull();
  });

  it('ignores a title refresh that resolves after another conversation is loaded', async () => {
    let resolveList: ((rows: unknown) => void) | undefined;
    const pendingList = new Promise((resolve) => {
      resolveList = resolve;
    });
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'save_conversation') return { conversation_id: 'conv-a' };
      if (cmd === 'load_conversation') return [];
      if (cmd === 'list_conversations') return pendingList;
      return undefined;
    });

    const { result } = renderHook(() => useConversationHistory());

    await act(async () => {
      await result.current.save(MESSAGES, MODEL);
    });
    await act(async () => {
      await result.current.loadConversation('conv-b');
    });

    // The list read started for conv-a resolves only now, when conv-b is active.
    await act(async () => {
      resolveList!([
        {
          id: 'conv-a',
          title: 'A title',
          model: MODEL,
          updated_at: 0,
          message_count: 1,
        },
      ]);
      await pendingList;
    });

    expect(result.current.conversationTitle).toBeNull();
  });
});
