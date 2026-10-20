import { motion } from 'framer-motion';
import { useRef, useEffect, useLayoutEffect } from 'react';
import { ChatBubble } from '../components/ChatBubble';
import { TypingIndicator } from '../components/TypingIndicator';
import { WindowControls } from '../components/WindowControls';
import type { Message } from '../types/chat';

/**
 * Props for the ConversationView component.
 * Describes the state of the active chat session.
 */
interface ConversationViewProps {
  /** Array of completed messages in the conversation. */
  messages: Message[];
  /** Whether the underlying LLM engine is currently generating a response. */
  isGenerating: boolean;
  /** Callback fired when the user requests to close the overlay. */
  onClose: () => void;
  /** Minimizes the window. */
  onMinimize: () => void;
  /**
   * Called when the bookmark icon is clicked to persist the conversation.
   * Omit to hide the save button.
   */
  onSave?: () => void;
  /**
   * True once the conversation has been saved. Renders the bookmark filled
   * and disables the button.
   */
  isSaved?: boolean;
  /**
   * True when there is at least one completed AI response available to save.
   * Controls whether the bookmark button is interactive.
   */
  canSave?: boolean;
  /**
   * Called when the "History ▾" button is clicked.
   * Omit to hide the history button.
   */
  onHistoryOpen?: () => void;
  /**
   * Called when the new-conversation (+) button is clicked.
   * Omit to hide the button.
   */
  onNewConversation?: () => void;
  /** Called when the user clicks a thumbnail to preview it. */
  onImagePreview?: (path: string) => void;
  /** Current conversation name shown in the header. Omit to hide it. */
  title?: string | null;
  /** Called with the new name when the user renames from the header. */
  onRenameTitle?: (title: string) => void;
  /** True while the window is pinned open against click-away hiding. */
  isPinned?: boolean;
  /** Called when the pin button is clicked. Omit to hide the button. */
  onTogglePin?: () => void;
  /**
   * Bumped by the parent to force the message list to the bottom (e.g. after
   * loading a saved conversation, or on Ctrl+End). Each new value re-enables
   * auto-scroll and pins the scroller to the latest message.
   */
  scrollToBottomSignal?: number;
  /**
   * Bumped by the parent on Ctrl+Home to scroll the transcript back to the
   * top. Undefined until the shortcut is first used, so mounting does not
   * interfere with the initial scroll-to-bottom.
   */
  scrollToTopSignal?: number;
}

/**
 * Renders the expanded chat history area of the QuickAI application.
 *
 * Caps its own height at the reply-box budget (`max-h-[600px]`, matching
 * `CHAT_CONTENT_MAX_HEIGHT` in `src/App.tsx`) so the native window always has
 * room for the input bar below it. Content beyond the visible area scrolls
 * inside the flex child.
 *
 * Encapsulates the scrolling logic ("smart auto-scroll") that pins the view
 * to new arriving tokens unless the user intercedes by scrolling up manually.
 */
export function ConversationView({
  messages,
  isGenerating,
  onClose,
  onMinimize,
  onSave,
  isSaved,
  canSave,
  onHistoryOpen,
  onNewConversation,
  onImagePreview,
  title,
  onRenameTitle,
  isPinned,
  onTogglePin,
  scrollToBottomSignal = 0,
  scrollToTopSignal,
}: ConversationViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /**
   * The transcript's content wrapper. Its height tracks the transcript's
   * content height — unlike the scroller's own box, which is capped by
   * `flex-1` — so a ResizeObserver on it fires whenever late-arriving content
   * (code blocks, images) changes the scrollable height after a pin has run.
   */
  const scrollContentRef = useRef<HTMLDivElement>(null);

  /** Threshold in pixels — if within this distance of the bottom, consider "near bottom". */
  const NEAR_BOTTOM_THRESHOLD = 60;

  /**
   * Tracks whether the view should auto-scroll to follow new content.
   *
   * Only **user-initiated** wheel events can disable auto-scroll (set to
   * `false` on upward scroll). This avoids false negatives from layout-induced
   * scroll events.
   *
   * Re-enabled when:
   * - The user scrolls back near the bottom (wheel deltaY > 0).
   * - A new message is added (`messages.length` changes).
   */
  const shouldAutoScrollRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);

  /**
   * Wheel listener — the only mechanism that can disable auto-scroll.
   * Wheel events are exclusively user-initiated (never fired by programmatic
   * scrollTop changes or layout reflows), making them a reliable signal for
   * "user scrolled up to read earlier content."
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    /* v8 ignore start */
    if (!container) return;
    /* v8 ignore stop */

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        shouldAutoScrollRef.current = false;
      } else if (e.deltaY > 0) {
        requestAnimationFrame(() => {
          const { scrollTop, scrollHeight, clientHeight } = container;
          if (scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD) {
            shouldAutoScrollRef.current = true;
          }
        });
      }
    };

    container.addEventListener('wheel', onWheel, { passive: true });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * Re-enable auto-scroll only when the user sends a new message.
   * Sending a message is an explicit "I want to see the response" action.
   * When an assistant message is finalized (streaming completes), we preserve
   * the current scroll lock state so the user can keep reading where they are.
   */
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      const newest = messages[messages.length - 1];
      if (newest?.role === 'user') {
        shouldAutoScrollRef.current = true;
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, messages]);

  /**
   * Auto-scroll the chat container to the bottom when new content arrives,
   * but only if the user hasn't manually scrolled up.
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    /* v8 ignore start */
    if (!container) return;
    /* v8 ignore stop */

    if (!shouldAutoScrollRef.current) return;

    const raf = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(raf);
  }, [messages, isGenerating]);

  /**
   * Force the scroller to the latest message when the parent requests it
   * (conversation load, Ctrl+End). Auto-scroll is re-enabled so the view stays
   * pinned to the bottom for the messages that follow.
   *
   * Runs in a layout effect so the jump happens before paint (no visible
   * "pull-down"), and re-pins on the next frame because images and markdown
   * rendered in the same commit can still change the content height after it.
   */
  useLayoutEffect(() => {
    shouldAutoScrollRef.current = true;
    const container = scrollContainerRef.current;
    /* v8 ignore start -- ref is always set after mount */
    if (!container) return;
    /* v8 ignore stop */
    container.scrollTop = container.scrollHeight;
    const raf = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToBottomSignal]);

  /**
   * Ctrl+Home scrolls the transcript back to the top. Auto-scroll is disabled
   * so arriving tokens do not immediately pull the view down again.
   *
   * The signal value present when this transcript mounted is ignored: a
   * leftover from a previous session must not open a fresh chat with
   * auto-scroll already off.
   */
  const mountTopSignalRef = useRef(scrollToTopSignal);

  useEffect(() => {
    if (scrollToTopSignal === undefined) return;
    if (scrollToTopSignal === mountTopSignalRef.current) return;
    shouldAutoScrollRef.current = false;
    const container = scrollContainerRef.current;
    /* v8 ignore start -- ref is always set after mount */
    if (!container) return;
    /* v8 ignore stop */
    container.scrollTop = 0;
  }, [scrollToTopSignal]);

  /**
   * Keep the transcript pinned to the bottom while auto-scroll is active.
   *
   * The load-time pin and the `[messages]` pin each run once, but content can
   * keep growing afterwards: a code block or image that lays out after the pin
   * changes `scrollHeight` and leaves the view parked short of the bottom — the
   * "switching back to a long conversation lands on a middle code block"
   * symptom. Observing the content wrapper re-pins on every such change, so a
   * conversation opened from history shows its bottom immediately. The user's
   * manual scroll-up still wins, because the callback respects auto-scroll mode.
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = scrollContentRef.current;
    /* v8 ignore start -- refs are always set after mount */
    if (!container || !content) return;
    /* v8 ignore stop */

    const observer = new ResizeObserver(() => {
      if (!shouldAutoScrollRef.current) return;
      container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      key="chat-area"
      data-chat-area
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ opacity: { duration: 0.2 } }}
      className="chat-area flex-1 min-h-0 flex flex-col max-h-[600px]"
    >
      <WindowControls
        onClose={onClose}
        onMinimize={onMinimize}
        onSave={onSave}
        isSaved={isSaved}
        canSave={canSave}
        onNewConversation={onNewConversation}
        onHistoryOpen={onHistoryOpen}
        title={title}
        onRenameTitle={onRenameTitle}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
      />

      <div
        ref={scrollContainerRef}
        className="chat-messages-scroll px-5 py-4 flex-1 min-h-0 overflow-y-auto"
      >
        {/* Content wrapper. Its height is the transcript's content height —
            what the ResizeObserver above watches so late content (code blocks,
            images) settling after a pin does not leave the view parked short of
            the bottom. `App` also reads it (via this attribute) as the
            window-sizing requirement, because the scroller's own box is flexed
            and therefore window-dependent. */}
        <div
          ref={scrollContentRef}
          data-chat-content
          className="flex flex-col gap-3"
        >
          {messages.map((msg, i) => {
            const isLastAssistant =
              isGenerating &&
              i === messages.length - 1 &&
              msg.role === 'assistant';

            // Hide the empty assistant placeholder; the TypingIndicator
            // already covers this visual state. When thinking content or a
            // non-fatal notice is present, render the bubble so they are visible.
            if (
              isLastAssistant &&
              !msg.content &&
              !msg.thinkingContent &&
              !msg.notice
            )
              return null;

            return (
              <ChatBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                quotedText={msg.quotedText}
                index={i}
                isStreaming={isLastAssistant}
                imagePaths={msg.imagePaths}
                onImagePreview={onImagePreview}
                error={msg.error}
                notice={msg.notice}
                thinkingContent={msg.thinkingContent}
                isThinking={
                  isLastAssistant && !msg.content && !!msg.thinkingContent
                }
              />
            );
          })}

          {/* Typing indicator (pulsing dots) shown before first token arrives */}
          {isGenerating &&
          messages[messages.length - 1]?.role === 'assistant' &&
          !messages[messages.length - 1]?.content &&
          !messages[messages.length - 1]?.thinkingContent ? (
            <TypingIndicator />
          ) : null}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, scaleX: 0 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 20,
          delay: 0.15,
        }}
        className="h-px shrink-0 bg-surface-border origin-center"
      />
    </motion.div>
  );
}
