/**
 * useChat — cloud chat streaming over the `ask` Tauri command.
 *
 * Manages message history and the streaming lifecycle: each `ask` call opens
 * a Tauri channel, streams tokens (and reasoning tokens) into the message
 * list, and reports completion, cancellation and provider errors.
 */
import { useState, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';

import { t } from '../i18n';
import { notifyIfUnfocused } from '../utils/notification';
import type { Message, StreamChunk } from '../types/chat';

export type { Message } from '../types/chat';

/**
 * A custom hook that owns the chat thread and streams responses from the
 * configured cloud provider via the provider-agnostic `ask` command.
 *
 * @param onTurnComplete Optional callback invoked after a complete
 *   user/assistant turn (i.e., when the `Done` chunk is received). Not called
 *   on `Cancelled` or `Error`. Used by the caller to persist completed turns.
 */
export function useChat(
  onTurnComplete?: (userMsg: Message, assistantMsg: Message) => void,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  /**
   * Submits a message and initiates the streaming response.
   *
   * @param displayContent The user's query as it should appear in the chat bubble.
   * @param quotedText Optional selected text quoted alongside this message.
   * @param imagePaths Optional array of absolute file paths for attached images.
   * @param think When true, requests the provider's reasoning mode.
   * @param promptOverride When provided, sent to the backend as the actual
   *   prompt instead of displayContent. The chat bubble still shows
   *   displayContent. Used by utility slash commands to send a composed prompt.
   */
  const ask = useCallback(
    async (
      displayContent: string,
      quotedText?: string,
      imagePaths?: string[],
      think?: boolean,
      promptOverride?: string,
    ) => {
      if (
        (!displayContent.trim() && (!imagePaths || imagePaths.length === 0)) ||
        isGenerating
      )
        return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: displayContent,
        quotedText,
        imagePaths:
          imagePaths && imagePaths.length > 0 ? imagePaths : undefined,
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsGenerating(true);

      const channel = new Channel<StreamChunk>();
      let currentContent = '';
      let currentThinkingContent = '';

      channel.onmessage = (chunk) => {
        switch (chunk.type) {
          case 'ThinkingToken': {
            currentThinkingContent += chunk.data;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, thinkingContent: currentThinkingContent }
                  : m,
              ),
            );
            break;
          }
          case 'Token': {
            currentContent += chunk.data;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: currentContent } : m,
              ),
            );
            break;
          }
          case 'Done': {
            setIsGenerating(false);
            // Show a desktop toast when the user has switched away from the app.
            void notifyIfUnfocused(t('notify.title'), t('notify.body'));
            // Notify the caller so it can persist the completed turn.
            onTurnComplete?.(userMsg, {
              ...assistantMsg,
              content: currentContent,
              thinkingContent: currentThinkingContent || undefined,
            });
            break;
          }
          case 'Cancelled': {
            // Remove the empty assistant placeholder if nothing was generated.
            if (!currentContent && !currentThinkingContent) {
              setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            }
            setIsGenerating(false);
            break;
          }
          case 'Error': {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, error: chunk.data } : m,
              ),
            );
            setIsGenerating(false);
            break;
          }
        }
      };

      try {
        await invoke('ask', {
          query: displayContent,
          context: quotedText ?? null,
          images: imagePaths && imagePaths.length > 0 ? imagePaths : null,
          think: think ?? false,
          promptOverride: promptOverride ?? null,
          onEvent: channel,
        });
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            error: {
              code: 'network',
              message: e instanceof Error ? e.message : String(e),
            },
          },
        ]);
        setIsGenerating(false);
      }
    },
    [isGenerating, onTurnComplete],
  );

  /** Cancels the currently active generation by signalling the Rust backend. */
  const cancel = useCallback(async () => {
    if (!isGenerating) return;
    await invoke('cancel_generation');
  }, [isGenerating]);

  /** Resets all conversation state to prepare for a fresh session. */
  const reset = useCallback(() => {
    setMessages([]);
    setIsGenerating(false);
    void invoke('reset_conversation');
  }, []);

  /**
   * Replaces the current message list with a previously loaded set of messages.
   *
   * Called after `load_conversation` returns from the backend. Does NOT call
   * `reset_conversation` to avoid conflicting with the epoch bump performed by
   * `load_conversation`.
   */
  const loadMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs);
    setIsGenerating(false);
  }, []);

  return {
    messages,
    ask,
    cancel,
    isGenerating,
    reset,
    loadMessages,
  };
}
