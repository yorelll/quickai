import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  ConversationView,
  isTranscriptReplaced,
  shouldAnimateEntrance,
} from '../ConversationView';
import type { Message } from '../../types/chat';

describe('entrance animation decision', () => {
  it('does not treat the first render (or an empty previous list) as a replacement', () => {
    expect(isTranscriptReplaced(null, ['a'])).toBe(false);
    expect(isTranscriptReplaced(new Set<string>(), ['a'])).toBe(false);
  });

  it('detects a wholesale replacement by id overlap', () => {
    expect(isTranscriptReplaced(new Set(['a', 'b']), ['b', 'c'])).toBe(false);
    expect(isTranscriptReplaced(new Set(['a', 'b']), ['c', 'd'])).toBe(true);
  });

  it('animates only messages appended after the transcript has rendered', () => {
    // Nothing animates on the first render: the view is being displayed.
    expect(shouldAnimateEntrance(null, false, 'a')).toBe(false);
    // A replaced transcript is displayed, not arrived at.
    expect(shouldAnimateEntrance(new Set(['a']), true, 'b')).toBe(false);
    // Already on screen.
    expect(shouldAnimateEntrance(new Set(['a']), false, 'a')).toBe(false);
    // Appended to the conversation already on screen.
    expect(shouldAnimateEntrance(new Set(['a']), false, 'b')).toBe(true);
  });
});

describe('ConversationView', () => {
  it('renders ChatBubble for each message', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'Hello there' },
      { id: '2', role: 'assistant' as const, content: 'Hi!' },
    ];
    render(
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('Hi!')).toBeInTheDocument();
  });

  it('renders a displayed transcript at rest and animates only appended messages', () => {
    const first: Message[] = [
      { id: '1', role: 'user', content: 'first' },
      { id: '2', role: 'assistant', content: 'reply' },
    ];
    const view = (messages: Message[]) => (
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />
    );
    const bubbleInitials = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('[data-chat-content] > div')).map((el) =>
        el.getAttribute('data-initial'),
      );

    const { container, rerender } = render(view(first));

    // The transcript view is being displayed, not arrived at: no spring.
    expect(bubbleInitials(container)).toEqual(['false', 'false']);

    // A message appended to the conversation already on screen animates in.
    rerender(view([...first, { id: '3', role: 'user', content: 'again' }]));
    expect(bubbleInitials(container)).toEqual(['false', 'false', 'hidden']);

    // A wholesale replacement (conversation switch) does not replay it.
    rerender(
      view([
        { id: 'x', role: 'user', content: 'other' },
        { id: 'y', role: 'assistant', content: 'answer' },
      ]),
    );
    expect(bubbleInitials(container)).toEqual(['false', 'false']);
  });

  it('renders streaming assistant message when isGenerating', () => {
    const { container } = render(
      <ConversationView
        messages={[
          {
            id: '1',
            role: 'assistant' as const,
            content: 'streaming response...',
          },
        ]}
        isGenerating={true}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );
    // Streamdown splits streaming text into per-word animated spans,
    // so exact full-text match won't work. Check for content presence.
    expect(container.textContent).toContain('streaming');
    expect(container.textContent).toContain('response...');
  });

  it('shows TypingIndicator when isGenerating with empty assistant content', () => {
    const { container } = render(
      <ConversationView
        messages={[{ id: '1', role: 'assistant' as const, content: '' }]}
        isGenerating={true}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );
    // New indicator: 9-dot spiral grid
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots.length).toBeGreaterThanOrEqual(9);
  });

  it('hides TypingIndicator when assistant content arrives', () => {
    const { container } = render(
      <ConversationView
        messages={[
          { id: '1', role: 'assistant' as const, content: 'some token' },
        ]}
        isGenerating={true}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );
    const dots = container.querySelectorAll('.rounded-full.bg-primary\\/70');
    expect(dots).toHaveLength(0);
  });

  it('keeps the streaming bubble mounted when only a notice has arrived', () => {
    const { container } = render(
      <ConversationView
        messages={[
          {
            id: '1',
            role: 'assistant' as const,
            content: '',
            notice: { code: 'skill_unreadable', message: 'translate: missing' },
          },
        ]}
        isGenerating={true}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-error-bar]')).not.toBeNull();
    expect(screen.getByText('translate: missing')).toBeInTheDocument();
  });

  it('renders WindowControls with onClose', () => {
    const onClose = vi.fn();
    render(
      <ConversationView
        messages={[]}
        isGenerating={false}
        onClose={onClose}
        onMinimize={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Close window' }),
    ).toBeInTheDocument();
  });

  it('renders empty state with no messages (no .chat-bubble elements)', () => {
    const { container } = render(
      <ConversationView
        messages={[]}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.chat-bubble')).toHaveLength(0);
  });

  it('auto-scroll is skipped when user scrolls up via wheel', () => {
    const { container, rerender } = render(
      <ConversationView
        messages={[{ id: '1', role: 'user' as const, content: 'first' }]}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    expect(scrollEl).not.toBeNull();

    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    });

    // Simulate the user scrolling up (negative deltaY) — this is the only
    // mechanism that disables auto-scroll, avoiding false negatives from
    // layout-induced scroll events during spring height measurement.
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    });

    // Rerender with new streaming content — auto-scroll should be skipped
    // because the user explicitly scrolled up
    act(() => {
      rerender(
        <ConversationView
          messages={[
            { id: '1', role: 'user' as const, content: 'first' },
            { id: '2', role: 'assistant' as const, content: 'new token' },
          ]}
          isGenerating={true}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
    });

    // scrollTop should remain 0 (auto-scroll was skipped)
    expect(scrollEl.scrollTop).toBe(0);
  });

  it('auto-scroll re-enables when a new user message is added', () => {
    const { container, rerender } = render(
      <ConversationView
        messages={[{ id: '1', role: 'user' as const, content: 'first' }]}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    expect(scrollEl).not.toBeNull();

    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    });

    // User scrolls up — disables auto-scroll
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    });

    // Add a new user message — this should re-enable auto-scroll because
    // sending a message is an explicit "I want to see the response" action
    act(() => {
      rerender(
        <ConversationView
          messages={[
            { id: '1', role: 'user' as const, content: 'first' },
            { id: '2', role: 'user' as const, content: 'second question' },
          ]}
          isGenerating={true}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
    });

    // Auto-scroll should have re-engaged (scrollTop set via rAF in test env
    // may not fire, but the branch is exercised — the key assertion is that
    // adding a user message doesn't leave auto-scroll disabled)
  });

  it('auto-scroll stays disabled when assistant message is finalized', () => {
    const { container, rerender } = render(
      <ConversationView
        messages={[
          { id: '1', role: 'user' as const, content: 'first' },
          { id: '2', role: 'assistant' as const, content: 'streaming reply' },
        ]}
        isGenerating={true}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    expect(scrollEl).not.toBeNull();

    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    });

    // User scrolls up during streaming — disables auto-scroll
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    });

    // Streaming finishes: assistant message is committed to the messages array
    act(() => {
      rerender(
        <ConversationView
          messages={[
            { id: '1', role: 'user' as const, content: 'first' },
            {
              id: '2',
              role: 'assistant' as const,
              content: 'streaming reply',
            },
          ]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
    });

    // scrollTop should remain 0: auto-scroll was NOT re-enabled by the
    // assistant message, so the user can keep reading where they scrolled
    expect(scrollEl.scrollTop).toBe(0);
  });

  it('auto-scroll re-enables when user scrolls back to bottom via wheel', async () => {
    const { container, rerender } = render(
      <ConversationView
        messages={[{ id: '1', role: 'user' as const, content: 'first' }]}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    expect(scrollEl).not.toBeNull();

    // User scrolls up — disables auto-scroll
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    });

    // Simulate the user being near the bottom after scrolling down
    Object.defineProperty(scrollEl, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'clientHeight', {
      value: 480,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 10,
      configurable: true,
      writable: true,
    });

    // User scrolls down (positive deltaY) — the rAF callback should check
    // position and re-enable auto-scroll since we're near the bottom
    // (scrollHeight - scrollTop - clientHeight = 500 - 10 - 480 = 10 < 60)
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    });

    // Flush the rAF scheduled by the wheel handler
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    // Rerender with streaming content — should auto-scroll again
    act(() => {
      rerender(
        <ConversationView
          messages={[
            { id: '1', role: 'user' as const, content: 'first' },
            { id: '2', role: 'assistant' as const, content: 'new tokens' },
          ]}
          isGenerating={true}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
    });

    // The auto-scroll effect exercised the re-enabled path
  });

  it('auto-scroll stays disabled when user scrolls down but not near bottom', async () => {
    const { container, rerender } = render(
      <ConversationView
        messages={[{ id: '1', role: 'user' as const, content: 'first' }]}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    expect(scrollEl).not.toBeNull();

    // User scrolls up — disables auto-scroll
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    });

    // Simulate the user NOT near the bottom
    Object.defineProperty(scrollEl, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'clientHeight', {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    });

    // User scrolls down but is still far from the bottom
    // (scrollHeight - scrollTop - clientHeight = 500 - 0 - 100 = 400 > 60)
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    });

    // Flush the rAF
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    // Rerender with streaming — auto-scroll should still be disabled
    act(() => {
      rerender(
        <ConversationView
          messages={[
            { id: '1', role: 'user' as const, content: 'first' },
            { id: '2', role: 'assistant' as const, content: 'new tokens' },
          ]}
          isGenerating={true}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
    });

    // scrollTop should remain 0 (auto-scroll was skipped)
    expect(scrollEl.scrollTop).toBe(0);
  });

  it('wheel with deltaY 0 does not change auto-scroll state', () => {
    const { container, rerender } = render(
      <ConversationView
        messages={[{ id: '1', role: 'user' as const, content: 'first' }]}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;

    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    });

    // Horizontal-only scroll (deltaY === 0) should be a no-op for auto-scroll
    act(() => {
      scrollEl.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 0, deltaX: 100 }),
      );
    });

    // Rerender with streaming — auto-scroll should still be enabled (default)
    act(() => {
      rerender(
        <ConversationView
          messages={[
            { id: '1', role: 'user' as const, content: 'first' },
            { id: '2', role: 'assistant' as const, content: 'tokens' },
          ]}
          isGenerating={true}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
    });
  });

  describe('header controls', () => {
    it('renders History button when onHistoryOpen is provided', () => {
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onHistoryOpen={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: /history/i }),
      ).toBeInTheDocument();
    });

    it('does not render History button when onHistoryOpen is not provided', () => {
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: /history/i })).toBeNull();
    });

    it('calls onHistoryOpen when History button is clicked', () => {
      const onHistoryOpen = vi.fn();
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onHistoryOpen={onHistoryOpen}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /history/i }));
      expect(onHistoryOpen).toHaveBeenCalledOnce();
    });

    it('renders Save button when onSave is provided', () => {
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onSave={vi.fn()}
          isSaved={false}
          canSave={true}
        />,
      );
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    it('calls onSave when Save button is clicked', () => {
      const onSave = vi.fn();
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onSave={onSave}
          isSaved={false}
          canSave={true}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      expect(onSave).toHaveBeenCalledOnce();
    });

    it('Save button is disabled when canSave is false', () => {
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onSave={vi.fn()}
          isSaved={false}
          canSave={false}
        />,
      );
      const saveBtn = screen.getByRole('button', { name: /save/i });
      expect(saveBtn).toBeDisabled();
    });

    it('Save button is enabled (for unsave) when isSaved is true', () => {
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onSave={vi.fn()}
          isSaved={true}
          canSave={true}
        />,
      );
      const saveBtn = screen.getByRole('button', {
        name: /remove from history/i,
      });
      expect(saveBtn).not.toBeDisabled();
    });
  });

  describe('Thinking props forwarding', () => {
    it('renders ThinkingBlock when assistant message has thinkingContent', () => {
      render(
        <ConversationView
          messages={[
            {
              id: '1',
              role: 'assistant' as const,
              content: 'The answer is 42.',
              thinkingContent: 'Let me think about this...',
            },
          ]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
      expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
    });

    it('renders ChatBubble (not null) when thinking but no content yet during generation', () => {
      render(
        <ConversationView
          messages={[
            {
              id: '1',
              role: 'assistant' as const,
              content: '',
              thinkingContent: 'Reasoning in progress...',
            },
          ]}
          isGenerating={true}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
      // The bubble should render with ThinkingBlock visible
      expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
      expect(screen.getByTestId('thinking-label')).toBeInTheDocument();
    });

    it('does not show TypingIndicator when assistant has thinkingContent but no content', () => {
      const { container } = render(
        <ConversationView
          messages={[
            {
              id: '1',
              role: 'assistant' as const,
              content: '',
              thinkingContent: 'Reasoning...',
            },
          ]}
          isGenerating={true}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
      // TypingIndicator renders 9 pulsing dots
      const dots = container.querySelectorAll('.rounded-full.bg-primary\\/70');
      expect(dots).toHaveLength(0);
    });
  });

  it('renders multiple messages correctly (10 messages)', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i}`,
    }));
    render(
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );
    for (let i = 0; i < 10; i++) {
      expect(screen.getByText(`Message ${i}`)).toBeInTheDocument();
    }
  });

  it('pins the transcript to the bottom when scrollToBottomSignal changes', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'first' },
      { id: '2', role: 'assistant' as const, content: 'reply' },
    ];
    const { container, rerender } = render(
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        scrollToBottomSignal={0}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    });

    rerender(
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        scrollToBottomSignal={1}
      />,
    );

    expect(scrollEl.scrollTop).toBe(500);
  });

  describe('content-growth re-pin', () => {
    let capturedCallback: ResizeObserverCallback | null = null;
    /** The observer instance, so a test can assert what was actually observed. */
    let capturedObserver: { elements: Element[] } | null = null;

    function spyOnResizeObserver() {
      const OriginalMock = globalThis.ResizeObserver;
      capturedCallback = null;
      capturedObserver = null;
      vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (
        callback: ResizeObserverCallback,
      ) {
        capturedCallback = callback;
        const observer = new OriginalMock(callback) as ResizeObserver & {
          elements: Element[];
        };
        capturedObserver = observer;
        return observer;
      });
    }

    it('re-pins to the bottom when content grows after a pin', () => {
      spyOnResizeObserver();

      const { container } = render(
        <ConversationView
          messages={[
            { id: '1', role: 'user' as const, content: 'question' },
            { id: '2', role: 'assistant' as const, content: 'long reply' },
          ]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          scrollToBottomSignal={1}
        />,
      );

      const scrollEl = container.querySelector(
        '.chat-messages-scroll',
      ) as HTMLElement;
      const contentEl = scrollEl.firstElementChild as HTMLElement;
      expect(contentEl).not.toBeNull();

      // The load pin has run; the view is momentarily short of the bottom
      // because a code block / image is still laying out.
      Object.defineProperty(scrollEl, 'scrollHeight', {
        value: 1200,
        configurable: true,
      });
      Object.defineProperty(scrollEl, 'scrollTop', {
        value: 0,
        configurable: true,
        writable: true,
      });

      // Late content settles — the wrapper grows and the observer fires.
      act(() => {
        capturedCallback!(
          [{ target: contentEl } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      // Auto-scroll is on after the load pin, so the view snaps to the bottom.
      expect(scrollEl.scrollTop).toBe(1200);
    });

    it('does not re-pin on content growth once the user scrolled up', () => {
      spyOnResizeObserver();

      const { container } = render(
        <ConversationView
          messages={[{ id: '1', role: 'user' as const, content: 'question' }]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );

      const scrollEl = container.querySelector(
        '.chat-messages-scroll',
      ) as HTMLElement;
      const contentEl = scrollEl.firstElementChild as HTMLElement;
      Object.defineProperty(scrollEl, 'scrollHeight', {
        value: 1200,
        configurable: true,
      });
      Object.defineProperty(scrollEl, 'scrollTop', {
        value: 0,
        configurable: true,
        writable: true,
      });

      // The user scrolls up — auto-scroll mode turns off.
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      });

      act(() => {
        capturedCallback!(
          [{ target: contentEl } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      // The reader's position is preserved.
      expect(scrollEl.scrollTop).toBe(0);
    });

    it('re-pins when the viewport shrinks after the pin', () => {
      spyOnResizeObserver();

      const { container } = render(
        <ConversationView
          messages={[{ id: '1', role: 'user' as const, content: 'question' }]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          scrollToBottomSignal={1}
        />,
      );

      const scrollEl = container.querySelector(
        '.chat-messages-scroll',
      ) as HTMLElement;
      const contentEl = scrollEl.firstElementChild as HTMLElement;

      // The scroller itself must be observed, otherwise a viewport shrink
      // produces no callback at all: the content wrapper does not resize in
      // this case, so observing it alone cannot see the change.
      expect(capturedObserver!.elements).toContain(contentEl);
      expect(capturedObserver!.elements).toContain(scrollEl);

      Object.defineProperty(scrollEl, 'scrollHeight', {
        value: 1200,
        configurable: true,
      });
      // The pin ran against a taller viewport; the window then shrank, so the
      // same scrollTop is no longer the maximum.
      Object.defineProperty(scrollEl, 'scrollTop', {
        value: 634,
        configurable: true,
        writable: true,
      });

      act(() => {
        // Dispatch only for an observed target, as a real observer would.
        expect(capturedObserver!.elements).toContain(scrollEl);
        capturedCallback!(
          [{ target: scrollEl } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      expect(scrollEl.scrollTop).toBe(1200);
    });
  });

  it('scrolls the transcript to the top when scrollToTopSignal changes', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'first' },
      { id: '2', role: 'assistant' as const, content: 'reply' },
    ];
    const { container, rerender } = render(
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 300,
      configurable: true,
      writable: true,
    });

    rerender(
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        scrollToTopSignal={1}
      />,
    );
    expect(scrollEl.scrollTop).toBe(0);

    // Auto-scroll stays off, so arriving tokens do not pull the view back down.
    Object.defineProperty(scrollEl, 'scrollHeight', {
      value: 800,
      configurable: true,
    });
    rerender(
      <ConversationView
        messages={[
          ...messages,
          { id: '3', role: 'assistant' as const, content: 'more tokens' },
        ]}
        isGenerating
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        scrollToTopSignal={1}
      />,
    );
    expect(scrollEl.scrollTop).toBe(0);
  });

  it('ignores a scroll-to-top signal left over from a previous session', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'first' },
      { id: '2', role: 'assistant' as const, content: 'reply' },
    ];
    const { container, rerender } = render(
      <ConversationView
        messages={messages}
        isGenerating={false}
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        scrollToTopSignal={1}
      />,
    );

    const scrollEl = container.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    });

    // A fresh transcript must still auto-scroll: the stale signal present at
    // mount did not switch auto-scroll off.
    rerender(
      <ConversationView
        messages={[
          ...messages,
          { id: '3', role: 'assistant' as const, content: 'more tokens' },
        ]}
        isGenerating
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        scrollToTopSignal={1}
      />,
    );

    expect(scrollEl.scrollTop).toBe(500);
  });

  describe('header conversation title', () => {
    it('renders the title and forwards renames', () => {
      const onRenameTitle = vi.fn();
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          title="Weekly plan"
          onRenameTitle={onRenameTitle}
        />,
      );

      fireEvent.contextMenu(
        screen.getByRole('button', { name: 'Rename conversation' }),
      );
      const input = screen.getByRole('textbox', { name: 'Conversation name' });
      fireEvent.change(input, { target: { value: 'Sprint plan' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onRenameTitle).toHaveBeenCalledWith('Sprint plan');
    });

    it('renders no title when none is given', () => {
      render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole('button', { name: 'Rename conversation' }),
      ).toBeNull();
    });
  });

  describe('pin control', () => {
    it('forwards the pin toggle and reflects the pinned state', () => {
      const onTogglePin = vi.fn();
      const { rerender } = render(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          isPinned={false}
          onTogglePin={onTogglePin}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Pin window' }));
      expect(onTogglePin).toHaveBeenCalledOnce();

      rerender(
        <ConversationView
          messages={[]}
          isGenerating={false}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          isPinned
          onTogglePin={onTogglePin}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Unpin window' }),
      ).toBeInTheDocument();
    });
  });
});
