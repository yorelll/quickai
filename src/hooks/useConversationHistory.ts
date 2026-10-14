import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Message } from '../types/chat';
import type {
  ConversationSummary,
  PersistedMessage,
  SaveConversationResponse,
  SaveMessagePayload,
} from '../types/history';

/**
 * Delay before re-fetching the conversation title so the fire-and-forget
 * `generate_title` task has time to land. The placeholder title written by
 * `save_conversation` is fetched immediately after saving; this second read
 * picks up the AI-generated replacement.
 */
const TITLE_REFRESH_DELAY_MS = 2500;

/**
 * Maps a frontend `Message` to the `SaveMessagePayload` shape expected by
 * the `save_conversation` and `generate_title` Tauri commands.
 */
function toPayload(msg: Message): SaveMessagePayload {
  return {
    role: msg.role,
    content: msg.content,
    quoted_text: msg.quotedText ?? null,
    image_paths: msg.imagePaths ?? null,
    thinking_content: msg.thinkingContent ?? null,
  };
}

/**
 * Maps a `PersistedMessage` returned by `load_conversation` back to a
 * frontend `Message`, preserving optional `quotedText`.
 */
function fromPersisted(msg: PersistedMessage): Message {
  const imagePaths = msg.image_paths
    ? (JSON.parse(msg.image_paths) as string[])
    : undefined;
  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
    quotedText: msg.quoted_text ?? undefined,
    imagePaths: imagePaths && imagePaths.length > 0 ? imagePaths : undefined,
    thinkingContent: msg.thinking_content ?? undefined,
  };
}

/**
 * Manages conversation persistence state for the current session.
 *
 * Tracks whether the active conversation has been saved to SQLite and provides
 * typed wrappers around all history-related Tauri commands. Intentionally has
 * no knowledge of streaming state or window management — those live in App.tsx
 * and `useChat`.
 *
 * @returns An object containing the current persistence state and all
 *   history operation callbacks.
 */
export function useConversationHistory() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  /** Name of the active conversation, shown in the chat header. */
  const [conversationTitle, setConversationTitle] = useState<string | null>(
    null,
  );
  /** Pending delayed title refresh, cancelled on reset/unmount. */
  const titleRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The conversation the UI is currently showing. Mirrored in a ref so a
   * late-arriving title refresh can tell whether it is still relevant.
   */
  const activeIdRef = useRef<string | null>(null);
  /**
   * Set once the user renames the active conversation by hand: a manual name
   * always wins over a late AI-generated title.
   */
  const titleLockedRef = useRef(false);

  /** True once the conversation has been saved to SQLite for the first time. */
  const isSaved = conversationId !== null;

  /**
   * Fetches the list of saved conversations, optionally filtered by title.
   *
   * @param search Optional case-insensitive search term applied against
   *   conversation titles.
   * @returns An array of `ConversationSummary` objects ordered by most-recently
   *   updated.
   */
  const listConversations = useCallback(
    async (search?: string): Promise<ConversationSummary[]> => {
      return invoke<ConversationSummary[]>('list_conversations', {
        search: search ?? null,
      });
    },
    [],
  );

  /**
   * Re-reads a conversation's stored title and adopts it for the header.
   * Best-effort: a failed lookup leaves the previous title untouched.
   */
  const refreshTitle = useCallback(
    async (id: string) => {
      try {
        const list = await listConversations();
        // Adopt the stored title only if this conversation is still on screen
        // and the user has not renamed it in the meantime.
        if (id === activeIdRef.current && !titleLockedRef.current) {
          setConversationTitle(list.find((c) => c.id === id)?.title ?? null);
        }
      } catch {
        // Title refresh is best-effort; the header keeps its current value.
      }
    },
    [listConversations],
  );

  /** Cancels a scheduled delayed title refresh, if one is pending. */
  const clearTitleRefresh = useCallback(() => {
    if (titleRefreshRef.current !== null) {
      clearTimeout(titleRefreshRef.current);
      titleRefreshRef.current = null;
    }
  }, []);

  // Cancel any pending refresh when the hook unmounts.
  useEffect(() => clearTitleRefresh, [clearTitleRefresh]);

  /**
   * Persists the current conversation to SQLite for the first time.
   * Subsequent calls while `isSaved` is true are no-ops — the bookmark
   * icon on the frontend enforces single-save semantics.
   *
   * Adopts the placeholder title the backend writes, then schedules a second
   * read to pick up the AI-generated title once `generate_title` finishes.
   *
   * @param messages The complete message history to persist.
   * @param model The chat model name used in this session.
   */
  const save = useCallback(
    async (messages: Message[], model: string): Promise<void> => {
      if (isSaved) return;

      // The SAME `payloads` array must reach both `save_conversation` and
      // `generate_title`: the backend's compare-and-set expects the title
      // placeholder it derives from these messages, so transforming or
      // appending to them between the two invokes would silently skip the
      // generated title.
      const payloads = messages.map(toPayload);

      const response = await invoke<SaveConversationResponse>(
        'save_conversation',
        {
          messages: payloads,
          model,
        },
      );

      setConversationId(response.conversation_id);
      activeIdRef.current = response.conversation_id;
      titleLockedRef.current = false;
      void refreshTitle(response.conversation_id);

      // Fire-and-forget: ask Rust to generate an AI title for the conversation.
      // The delayed refresh above picks up the result once it lands.
      void invoke('generate_title', {
        conversationId: response.conversation_id,
        messages: payloads,
      }).catch(() => {
        // Non-fatal: the conversation keeps the placeholder name it was saved
        // with, and the rest of the session is unaffected.
      });

      clearTitleRefresh();
      titleRefreshRef.current = setTimeout(() => {
        titleRefreshRef.current = null;
        void refreshTitle(response.conversation_id);
      }, TITLE_REFRESH_DELAY_MS);
    },
    [isSaved, refreshTitle, clearTitleRefresh],
  );

  /**
   * Appends a completed user/assistant turn to the already-saved conversation.
   * No-op if the conversation has not been saved yet — partial conversations
   * are only persisted after an explicit save.
   *
   * @param userMsg The user message from the completed turn.
   * @param assistantMsg The assistant response from the completed turn.
   */
  const persistTurn = useCallback(
    async (userMsg: Message, assistantMsg: Message): Promise<void> => {
      if (!isSaved || conversationId === null) return;

      await Promise.all([
        invoke('persist_message', {
          conversationId,
          role: userMsg.role,
          content: userMsg.content,
          quotedText: userMsg.quotedText ?? null,
          imagePaths: userMsg.imagePaths ?? null,
          thinkingContent: null,
        }),
        invoke('persist_message', {
          conversationId,
          role: assistantMsg.role,
          content: assistantMsg.content,
          quotedText: assistantMsg.quotedText ?? null,
          imagePaths: null,
          thinkingContent: assistantMsg.thinkingContent ?? null,
        }),
      ]);
    },
    [isSaved, conversationId],
  );

  /**
   * Loads a saved conversation from SQLite.
   *
   * Calls the `load_conversation` Tauri command, which atomically syncs the
   * backend `ConversationHistory` state and bumps the epoch counter so any
   * in-flight streaming turn cannot corrupt the newly loaded history.
   *
   * @param id The UUID of the conversation to load.
   * @returns The conversation messages mapped to frontend `Message` shape.
   */
  const loadConversation = useCallback(
    async (id: string): Promise<Message[]> => {
      const persisted = await invoke<PersistedMessage[]>('load_conversation', {
        conversationId: id,
      });
      setConversationId(id);
      activeIdRef.current = id;
      titleLockedRef.current = false;
      // A refresh queued for the previous conversation must not overwrite the
      // one just loaded.
      clearTitleRefresh();
      void refreshTitle(id);
      return persisted.map(fromPersisted);
    },
    [refreshTitle, clearTitleRefresh],
  );

  /**
   * Permanently deletes a saved conversation and all its messages from SQLite.
   *
   * @param id The UUID of the conversation to delete.
   */
  const deleteConversation = useCallback(async (id: string): Promise<void> => {
    await invoke('delete_conversation', { conversationId: id });
  }, []);

  /**
   * Renames a conversation and, when it is the active one, updates the header
   * immediately so the change is visible without a round-trip.
   *
   * @param id The UUID of the conversation to rename.
   * @param title The new conversation name.
   */
  const renameConversation = useCallback(
    async (id: string, title: string): Promise<void> => {
      await invoke('rename_conversation', { conversationId: id, title });
      if (id === conversationId) {
        // A manual name wins: block any late AI title from replacing it.
        titleLockedRef.current = true;
        setConversationTitle(title);
      }
    },
    [conversationId],
  );

  /**
   * Removes the current conversation from SQLite without clearing the
   * in-memory message history. After this call `isSaved` is false and the
   * session is treated as unsaved again (the user can re-save if desired).
   */
  const unsave = useCallback(async (): Promise<void> => {
    if (!isSaved || conversationId === null) return;
    await invoke('delete_conversation', { conversationId });
    setConversationId(null);
    activeIdRef.current = null;
    titleLockedRef.current = false;
    setConversationTitle(null);
    clearTitleRefresh();
  }, [isSaved, conversationId, clearTitleRefresh]);

  /**
   * Clears the local persistence state, marking the session as unsaved.
   *
   * Does NOT call `reset_conversation` on the backend. When clearing the
   * full session (new conversation), call `useChat.reset()` alongside this
   * so the backend history is also wiped. When only marking a conversation as
   * unsaved while keeping messages visible (e.g. after deletion from history),
   * calling this alone is correct — `persistTurn` will no-op and the backend
   * context is rebuilt from the frontend messages on the next request.
   */
  const reset = useCallback(() => {
    setConversationId(null);
    activeIdRef.current = null;
    titleLockedRef.current = false;
    setConversationTitle(null);
    clearTitleRefresh();
  }, [clearTitleRefresh]);

  return {
    conversationId,
    conversationTitle,
    isSaved,
    save,
    unsave,
    persistTurn,
    loadConversation,
    deleteConversation,
    listConversations,
    renameConversation,
    reset,
  };
}
