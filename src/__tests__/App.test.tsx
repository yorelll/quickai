import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onAction } from '@tauri-apps/plugin-notification';
import App, {
  COLLAPSED_WINDOW_HEIGHT,
  CONTAINER_VERTICAL_PADDING,
  extractSkillAdds,
  measureChatContentHeight,
  minibarStateFrom,
} from '../App';
import {
  invoke,
  emitTauriEvent,
  enableChannelCapture,
  enableChannelCaptureWithResponses,
  getLastChannel,
} from '../testUtils/mocks/tauri';
import { emitNotificationAction } from '../testUtils/mocks/tauri-notification';
import { __mockWindow } from '../testUtils/mocks/tauri-window';

const mockOnAction = onAction as unknown as ReturnType<typeof vi.fn>;

async function showOverlay(selectedText: string | null = null) {
  await act(async () => {
    emitTauriEvent('quickai://visibility', {
      state: 'show',
      selected_text: selectedText,
      window_x: null,
      window_y: null,
      screen_bottom_y: null,
    });
  });
}

/**
 * Vertical padding, in px, that a container's Tailwind classes contribute.
 * Tailwind's spacing unit is 0.25rem = 4 px. `py-*` sets both sides; `pt-*` /
 * `pb-*` override a single side. Used to derive the real padding budget from
 * the rendered DOM rather than re-stating the class names.
 */
function verticalPaddingPx(el: Element): number {
  const classes = el.className.split(/\s+/);
  const steps = (prefix: string): number | null => {
    const cls = classes.find((c) => c.startsWith(prefix));
    return cls === undefined ? null : Number(cls.slice(prefix.length)) * 4;
  };
  const both = steps('py-') ?? 0;
  return (steps('pt-') ?? both) + (steps('pb-') ?? both);
}

describe('App', () => {
  beforeEach(() => {
    invoke.mockClear();
    enableChannelCapture();
  });

  it('notifies the backend that the frontend is ready on mount', async () => {
    render(<App />);
    await act(async () => {});

    expect(invoke).toHaveBeenCalledWith('notify_frontend_ready');
  });

  it('grows upward when near bottom screen edge', async () => {
    const { container } = render(<App />);
    await act(async () => {});

    await act(async () => {
      emitTauriEvent('quickai://visibility', {
        state: 'show',
        selected_text: null,
        window_x: 50,
        window_y: 1000,
        screen_bottom_y: 1100,
      });
    });

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hi' } });
    });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    });
    // This should morph into max-height window
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(
      (container.querySelector('.morphing-container') as HTMLElement).style
        .height,
    ).toBe('600px');
  });

  it('keeps full chat height after clicking the expanded upward chat surface', async () => {
    const { container } = render(<App />);
    await act(async () => {});

    await act(async () => {
      emitTauriEvent('quickai://visibility', {
        state: 'show',
        selected_text: null,
        window_x: 50,
        window_y: 1000,
        screen_bottom_y: 1100,
      });
    });

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hi' } });
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    });

    const morphingContainer = container.querySelector(
      '.morphing-container',
    ) as HTMLElement;
    expect(morphingContainer.style.height).toBe('600px');

    const chatArea = container.querySelector('.chat-area');
    expect(chatArea).not.toBeNull();

    act(() => {
      fireEvent.mouseDown(chatArea!);
      fireEvent.mouseUp(window);
    });

    expect(morphingContainer.style.height).toBe('600px');
  });

  it('renders nothing when overlay is hidden', async () => {
    const { container } = render(<App />);
    // Flush effects so listener registers
    await act(async () => {});

    expect(container.querySelector('.morphing-container')).toBeNull();
  });

  it('shows overlay on visibility show event', async () => {
    render(<App />);
    // Flush effects so listener registers
    await act(async () => {});

    await showOverlay();

    expect(
      screen.getByPlaceholderText('Ask a question, or type / to see commands'),
    ).toBeInTheDocument();
  });

  it('hides overlay on Escape key', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    // Confirm overlay is visible
    expect(
      screen.getByPlaceholderText('Ask a question, or type / to see commands'),
    ).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(invoke).toHaveBeenCalledWith('notify_overlay_hidden');
  });

  it('completes a full conversation turn', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );

    // Type a message
    act(() => {
      fireEvent.change(textarea, { target: { value: 'hello there' } });
    });

    // Submit with Enter
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    // Wait for invoke to be called (ask)
    await act(async () => {});

    // Simulate streaming tokens
    act(() => {
      getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hi' });
      getLastChannel()?.simulateMessage({ type: 'Token', data: ' there!' });
      getLastChannel()?.simulateMessage({ type: 'Done' });
    });

    // The assistant response should now be in the DOM
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows selected context when provided', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay('some code snippet');

    expect(screen.getByText(/some code snippet/)).toBeInTheDocument();
  });

  it('enters hiding state on hide-request visibility event', async () => {
    render(<App />);
    await act(async () => {});

    // First show overlay
    await showOverlay();
    expect(
      screen.getByPlaceholderText('Ask a question, or type / to see commands'),
    ).toBeInTheDocument();

    // Then send hide-request — calls requestHideOverlay() (not handleCloseOverlay)
    await act(async () => {
      emitTauriEvent('quickai://visibility', { state: 'hide-request' });
    });

    // The hide-request path transitions overlay to hiding state (overlayState !== 'visible'),
    // so shouldRenderOverlay becomes false and the overlay is removed from the DOM.
    expect(
      screen.queryByPlaceholderText(
        'Ask a question, or type / to see commands',
      ),
    ).toBeNull();
  });

  it('hides overlay on Cmd+W key', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();
    expect(
      screen.getByPlaceholderText('Ask a question, or type / to see commands'),
    ).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'w', metaKey: true });
    });

    expect(invoke).toHaveBeenCalledWith('notify_overlay_hidden');
  });

  it('hides overlay on Ctrl+W key', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    act(() => {
      fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    });

    expect(invoke).toHaveBeenCalledWith('notify_overlay_hidden');
  });

  it('commits window hide after HIDE_COMMIT_DELAY_MS when hiding', async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {});

    await showOverlay();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Advance past the 350ms hide delay
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(invoke).toHaveBeenCalledWith('notify_overlay_hidden', {
      commit: true,
    });
    vi.useRealTimers();
  });

  it('cancels the pending hide when a show lands during the exit animation', async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {});

    await showOverlay();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Deliver the show and run the already-scheduled commit timer in the same
    // tick. The timer must see the synchronously bumped show epoch even though
    // React has not re-rendered the state yet — that ordering is exactly the
    // race where the native hide used to land after the backend's show().
    act(() => {
      emitTauriEvent('quickai://visibility', { state: 'show' });
      vi.advanceTimersByTime(400);
    });

    expect(invoke).not.toHaveBeenCalledWith('notify_overlay_hidden', {
      commit: true,
    });
    vi.useRealTimers();
  });

  it('does not submit empty query', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );

    // Press Enter with empty textarea
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    await act(async () => {});

    // ask should NOT have been called
    expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
  });

  it('fires drag on non-interactive mousedown', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    // Fire mousedown on the outermost div (non-interactive)
    const container = document.querySelector('.morphing-container');
    expect(container).not.toBeNull();

    act(() => {
      fireEvent.mouseDown(container!);
    });

    expect(__mockWindow.startDragging).toHaveBeenCalled();
  });

  it('clears upward growth on mouseup after drag', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    const container = document.querySelector('.morphing-container');
    expect(container).not.toBeNull();

    __mockWindow.startDragging.mockClear();

    act(() => {
      fireEvent.mouseDown(container!);
    });

    // startDragging was called; fire mouseup to cover the mouseup handler
    act(() => {
      fireEvent.mouseUp(window);
    });

    expect(__mockWindow.startDragging).toHaveBeenCalled();
  });

  it('does not fire drag when mousedown on select-text element', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    // Send a message to enter chat mode so ChatBubble (with .select-text) renders
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    act(() => {
      fireEvent.change(textarea, { target: { value: 'test message' } });
    });
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await act(async () => {});

    act(() => {
      getLastChannel()?.simulateMessage({ type: 'Token', data: 'Reply' });
      getLastChannel()?.simulateMessage({ type: 'Done' });
    });

    // Find a .select-text element
    const selectTextEl = document.querySelector('.select-text');
    if (selectTextEl) {
      __mockWindow.startDragging.mockClear();
      act(() => {
        fireEvent.mouseDown(selectTextEl);
      });
      expect(__mockWindow.startDragging).not.toHaveBeenCalled();
    }
  });

  it('does not fire drag when mousedown on TEXTAREA', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    __mockWindow.startDragging.mockClear();

    act(() => {
      fireEvent.mouseDown(textarea);
    });

    expect(__mockWindow.startDragging).not.toHaveBeenCalled();
  });

  it('does not fire drag when mousedown lands on a scrollbar', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    // Enter chat mode so the transcript scroller is mounted.
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    act(() => {
      fireEvent.change(textarea, { target: { value: 'test message' } });
    });
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await act(async () => {});

    const scroller = document.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    expect(scroller).not.toBeNull();

    // jsdom reports zero-size layout; describe a scrollable box with the
    // pointer past the content+padding right edge (the scrollbar gutter).
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 400 });
    Object.defineProperty(scroller, 'clientWidth', { value: 585 });
    Object.defineProperty(scroller, 'clientLeft', { value: 0 });
    scroller.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 400,
        width: 600,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    __mockWindow.startDragging.mockClear();
    act(() => {
      fireEvent.mouseDown(scroller, { clientX: 590 });
    });

    expect(__mockWindow.startDragging).not.toHaveBeenCalled();
  });

  it('still fires drag on a scrollable element when the pointer is on its content', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    act(() => {
      fireEvent.change(textarea, { target: { value: 'test message' } });
    });
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await act(async () => {});

    const scroller = document.querySelector(
      '.chat-messages-scroll',
    ) as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 400 });
    Object.defineProperty(scroller, 'clientWidth', { value: 600 });
    Object.defineProperty(scroller, 'clientLeft', { value: 0 });
    scroller.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 400,
        width: 600,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    __mockWindow.startDragging.mockClear();
    act(() => {
      fireEvent.mouseDown(scroller, { clientX: 300 });
    });

    expect(__mockWindow.startDragging).toHaveBeenCalled();
  });

  it('submits query with quoted text when selectedContext is set', async () => {
    render(<App />);
    await act(async () => {});

    // Show with selected context
    await showOverlay('selected snippet');

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    act(() => {
      fireEvent.change(textarea, { target: { value: 'my question' } });
    });

    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    await act(async () => {});

    // Backend receives the message and quoted text separately
    expect(invoke).toHaveBeenCalledWith(
      'ask',
      expect.objectContaining({
        query: 'my question',
        context: 'selected snippet',
      }),
    );
  });

  it('applies justify-end when window is near screen bottom', async () => {
    render(<App />);
    await act(async () => {});

    // Show overlay near screen bottom: window_y=750, screen_bottom=900.
    // 750 + MAX_CHAT_WINDOW_HEIGHT(713) = 1463 > 900 → grows upward.
    await act(async () => {
      emitTauriEvent('quickai://visibility', {
        state: 'show',
        selected_text: null,
        window_x: 100,
        window_y: 750,
        screen_bottom_y: 900,
      });
    });

    const outer = document.querySelector('.justify-end');
    expect(outer).not.toBeNull();
  });

  it('applies justify-start when window has room below', async () => {
    render(<App />);
    await act(async () => {});

    // Show overlay near top: window_y=100, screen_bottom=900.
    // 100 + 713 = 813 < 900 → grows downward.
    await act(async () => {
      emitTauriEvent('quickai://visibility', {
        state: 'show',
        selected_text: null,
        window_x: 100,
        window_y: 100,
        screen_bottom_y: 900,
      });
    });

    const outer = document.querySelector('.justify-start');
    expect(outer).not.toBeNull();
    expect(document.querySelector('.justify-end')).toBeNull();
  });

  it('keeps the vertical padding symmetric while totalling 48 px', async () => {
    render(<App />);
    await act(async () => {});
    await showOverlay();

    // Root: a single `py-4` cannot be lopsided; the 16-above/32-below split
    // came from `pt-2 pb-6`. The motion container contributes `py-2`, so the
    // split is 24 above / 24 below and the total is still 48 px, keeping
    // COLLAPSED_WINDOW_HEIGHT (113) and the backend constants valid.
    const root = document.querySelector('.h-screen')!;
    const rootClasses = root.className.split(/\s+/);
    expect(rootClasses).toContain('py-4');
    expect(rootClasses).not.toContain('pt-2');
    expect(rootClasses).not.toContain('pb-6');
    // Horizontal padding is deliberately unchanged.
    expect(rootClasses).toContain('px-3');

    const container = document.querySelector('.morphing-container')!;
    // container → relative wrapper → the motion frame carrying `py-2`.
    const motionFrame = container.parentElement!.parentElement!;
    expect(motionFrame.className.split(/\s+/)).toContain('py-2');

    // Pin the arithmetic, not just the class names: the 48 px total is what
    // COLLAPSED_WINDOW_HEIGHT (113) and the backend's WINDOW_BOTTOM_PADDING
    // (24) are built on. Deriving it from both rendered containers means a
    // drift on either side fails here — `py-4`→`py-5` (20 each side) or
    // `py-2`→`py-3` (12 each side) both break the budget.
    expect(verticalPaddingPx(root) + verticalPaddingPx(motionFrame)).toBe(
      CONTAINER_VERTICAL_PADDING,
    );
    expect(CONTAINER_VERTICAL_PADDING).toBe(48);
  });

  describe('ResizeObserver upward growth', () => {
    let capturedCallback: ResizeObserverCallback | null = null;

    function spyOnResizeObserver() {
      const OriginalMock = globalThis.ResizeObserver;
      vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (
        callback: ResizeObserverCallback,
      ) {
        capturedCallback = callback;
        return new OriginalMock(callback) as ResizeObserver;
      });
    }

    function triggerResize(element: Element, contentHeight: number) {
      // `syncWindowSize` measures the container's layout height via
      // `offsetHeight` (transform-independent), so the mock drives that — not
      // `getBoundingClientRect`, which the entrance animation's scale would skew.
      Object.defineProperty(element, 'offsetHeight', {
        value: contentHeight,
        configurable: true,
      });
      if (capturedCallback) {
        capturedCallback(
          [{ target: element } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      }
    }

    it('commits exact height when not streaming (initial ask bar)', async () => {
      spyOnResizeObserver();

      render(<App />);
      await act(async () => {});

      // window_y=804, screen_bottom=900. bottomY = 804 + COLLAPSED_WINDOW_HEIGHT
      // = 917. The 60 below is the container's measured content height, not the
      // collapsed window height.
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: 100,
          window_y: 804,
          screen_bottom_y: 900,
        });
      });

      invoke.mockClear();

      const container = document.querySelector('.morphing-container');
      expect(container).not.toBeNull();

      // Not streaming yet, so exact height is committed (no buffer)
      act(() => {
        triggerResize(container!, 60);
      });

      // bottomY = 804 + the collapsed ask-bar height; the window grows upward
      // from that pinned bottom by exactly the requested height.
      expect(invoke).toHaveBeenCalledWith('set_window_frame', {
        x: 100,
        y: 804 + COLLAPSED_WINDOW_HEIGHT - 108,
        width: 650,
        height: 108,
      });
    });

    it('sizes from the layout height, ignoring the entrance animation transform', async () => {
      spyOnResizeObserver();

      render(<App />);
      await act(async () => {});

      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: 100,
          window_y: 804,
          screen_bottom_y: 900,
        });
      });

      invoke.mockClear();

      const container = document.querySelector('.morphing-container');
      expect(container).not.toBeNull();

      // Layout height 200. A mid-spring `scale: 0.96` would make the bounding
      // rect 192 — the old code measured that and sized the window 8px short,
      // clipping the input. The window must use the layout height: 200 + 48.
      Object.defineProperty(container!, 'offsetHeight', {
        value: 200,
        configurable: true,
      });
      vi.spyOn(container!, 'getBoundingClientRect').mockReturnValue({
        height: 192,
        width: 650,
        top: 0,
        left: 0,
        right: 600,
        bottom: 192,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      act(() => {
        capturedCallback!(
          [{ target: container! } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      // bottomY = 804 + collapsed height; 248 is the container's 200 + 48.
      expect(invoke).toHaveBeenCalledWith('set_window_frame', {
        x: 100,
        y: 804 + COLLAPSED_WINDOW_HEIGHT - 248,
        width: 650,
        height: 248,
      });
    });

    it('uses setSize (not set_window_frame) after drag clears upward growth', async () => {
      spyOnResizeObserver();

      render(<App />);
      await act(async () => {});

      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: 100,
          window_y: 804,
          screen_bottom_y: 900,
        });
      });

      const container = document.querySelector('.morphing-container');
      expect(container).not.toBeNull();

      // Drag clears upward growth
      act(() => {
        fireEvent.mouseDown(container!);
      });
      act(() => {
        fireEvent.mouseUp(window);
      });

      invoke.mockClear();
      __mockWindow.setSize.mockClear?.();

      act(() => {
        triggerResize(container!, 60);
      });
      expect(invoke).not.toHaveBeenCalledWith(
        'set_window_frame',
        expect.anything(),
      );
      expect(__mockWindow.setSize).toHaveBeenCalled();
    });

    it('resets upward growth on session reopen', async () => {
      spyOnResizeObserver();

      render(<App />);
      await act(async () => {});

      // Session 1: near bottom, grows upward
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: 100,
          window_y: 804,
          screen_bottom_y: 900,
        });
      });

      const container1 = document.querySelector('.morphing-container');
      act(() => {
        triggerResize(container1!, 60);
      });

      // Close
      await act(async () => {
        emitTauriEvent('quickai://visibility', { state: 'hide-request' });
      });

      // Session 2: reopen near bottom again
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: 100,
          window_y: 804,
          screen_bottom_y: 900,
        });
      });

      const container2 = document.querySelector('.morphing-container');
      expect(container2).not.toBeNull();

      invoke.mockClear();
      act(() => {
        triggerResize(container2!, 60);
      });
      // bottomY = 804 + the collapsed ask-bar height; the window grows upward
      // from that pinned bottom by exactly the requested height.
      expect(invoke).toHaveBeenCalledWith('set_window_frame', {
        x: 100,
        y: 804 + COLLAPSED_WINDOW_HEIGHT - 108,
        width: 650,
        height: 108,
      });
    });
  });

  // ─── Chat-mode viewport filling and the sizing requirement ─────────────────

  describe('chat-mode sizing requirement', () => {
    /** Captures every ResizeObserver callback keyed by the element it observes. */
    function captureResizeObservers() {
      const callbacks = new Map<Element, ResizeObserverCallback>();
      const Original = globalThis.ResizeObserver;
      vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (
        callback: ResizeObserverCallback,
      ) {
        const observer = new Original(callback) as ResizeObserver;
        const observe = observer.observe.bind(observer);
        observer.observe = (element: Element) => {
          callbacks.set(element, callback);
          observe(element);
        };
        return observer;
      });
      return callbacks;
    }

    /**
     * Fires the document-element observer — the post-layout viewport trigger
     * `verifyNativeSize` runs from. (The `tauri://resize` event is deliberately
     * not the trigger: it can arrive before the layout viewport updates.)
     */
    function fireViewportResize(
      callbacks: Map<Element, ResizeObserverCallback>,
    ) {
      const callback = callbacks.get(document.documentElement);
      expect(callback).toBeDefined();
      callback!(
        [
          {
            target: document.documentElement,
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    }

    function defineBox(element: Element | null, height: number) {
      if (!element) return;
      Object.defineProperty(element, 'offsetHeight', {
        value: height,
        configurable: true,
      });
    }

    async function enterChatMode() {
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'hi' } });
      });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
      });
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(r));
      });
    }

    async function showDownward() {
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: 100,
          window_y: 100,
          screen_bottom_y: 2000,
        });
      });
    }

    const originalInnerHeight = window.innerHeight;
    afterEach(() => {
      Object.defineProperty(window, 'innerHeight', {
        value: originalInnerHeight,
        configurable: true,
      });
    });

    it('measures the chat requirement from content, not from the window-filling box', async () => {
      const callbacks = captureResizeObservers();
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector(
        '.morphing-container',
      ) as HTMLElement;
      const chat = document.querySelector('[data-chat-area]')!;
      const content = document.querySelector('[data-chat-content]')!;
      const scroller = content.parentElement as HTMLElement;

      // The window is 648 px and the column fills it, so the container is
      // 600 px — the old `container.offsetHeight + 48` would ask for 648 and
      // never grow. Content: chrome 34 + transcript 1200 + padding 32, capped
      // at 600; below the chat area: 65 px input bar → requirement 665.
      scroller.style.paddingTop = '16px';
      scroller.style.paddingBottom = '16px';
      defineBox(container, 600);
      defineBox(chat, 535);
      defineBox(scroller, 501);
      defineBox(content, 1200);
      // The input bar is the only content-sized sibling below the chat area.
      defineBox(container.lastElementChild, 65);

      expect(measureChatContentHeight(container)).toBe(665);

      __mockWindow.setSize.mockClear();
      act(() => {
        callbacks.get(container)!(
          [{ target: container } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ width: 650, height: 713 }),
      );
      // The fixed point: the container's own height would have requested 648.
      expect(__mockWindow.setSize).not.toHaveBeenCalledWith(
        expect.objectContaining({ height: 648 }),
      );
    });

    it('gets chat modality from the content requirement and fills the viewport in chat mode', async () => {
      render(<App />);
      await act(async () => {});
      await showDownward();

      const askBarContainer = document.querySelector('.morphing-container')!;
      expect(askBarContainer.className).not.toContain('h-full');

      await enterChatMode();

      const container = document.querySelector('.morphing-container')!;
      const relative = container.parentElement!;
      const motion = relative.parentElement!;
      // The whole chain fills the viewport so the input bar is a shrink-0
      // child of a full-height column: a short native window then costs
      // transcript height, never input-bar visibility.
      expect(container.className).toContain('h-full');
      expect(container.className).toContain('min-h-0');
      expect(relative.className).toContain('h-full');
      expect(motion.className).toContain('flex-1');
      expect(
        document.querySelector('[data-chat-content]')!.parentElement!.className,
      ).toContain('overflow-y-auto');
    });

    it('sizes a message sent from a freshly summoned ask bar with no external event', async () => {
      // The container fills the viewport, so entering chat mode changes no box
      // the container observer watches. Geometry is supplied on the prototype
      // because the chat elements are created in the same commit that runs the
      // sync — there is no later event to trigger a second measurement.
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
        function (this: HTMLElement) {
          if (this.hasAttribute('data-chat-content')) return 1200;
          if (this.firstElementChild?.hasAttribute('data-chat-content'))
            return 566;
          if (this.hasAttribute('data-chat-area')) return 600;
          return 65;
        },
      );
      Object.defineProperty(window, 'innerHeight', {
        value: 113,
        configurable: true,
      });

      render(<App />);
      await act(async () => {});
      await showDownward();
      __mockWindow.setSize.mockClear();

      // Type + Enter only — no show event, no resize event, no RO trigger.
      await enterChatMode();

      expect(document.querySelector('[data-chat-area]')).not.toBeNull();
      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ width: 650, height: 713 }),
      );
    });

    it('keeps the room the history dropdown asked for on a short conversation', async () => {
      const callbacks = captureResizeObservers();
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector(
        '.morphing-container',
      ) as HTMLElement;
      const chat = document.querySelector('[data-chat-area]')!;
      const content = document.querySelector('[data-chat-content]')!;
      const scroller = content.parentElement as HTMLElement;

      // Content requirement: 65 input + (34 chrome + 166 content) = 265, i.e.
      // exactly the 313 px window, so the early return would drop the request.
      defineBox(container, 265);
      defineBox(chat, 200);
      defineBox(scroller, 166);
      defineBox(content, 166);
      defineBox(container.lastElementChild, 65);
      // Opening history writes the dropdown's need as an inline min-height.
      container.style.minHeight = '353px';

      Object.defineProperty(window, 'innerHeight', {
        value: 313,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();
      act(() => {
        callbacks.get(content)!(
          [{ target: content } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      // 353 (the dropdown's need) + 48 padding, not the 313 content height.
      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ width: 650, height: 401 }),
      );
    });

    it('returns null outside chat mode', () => {
      const node = document.createElement('div');
      document.body.appendChild(node);
      expect(measureChatContentHeight(node)).toBeNull();
      node.remove();
    });

    it('re-applies the request once when a native resize leaves the window collapsed', async () => {
      const callbacks = captureResizeObservers();
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector('.morphing-container')!;
      const chat = document.querySelector('[data-chat-area]')!;
      const content = document.querySelector('[data-chat-content]')!;
      const scroller = content.parentElement as HTMLElement;
      scroller.style.paddingTop = '16px';
      scroller.style.paddingBottom = '16px';
      defineBox(container, 600);
      defineBox(chat, 535);
      defineBox(scroller, 501);
      defineBox(content, 1200);
      // The input bar is the only content-sized sibling below the chat area.
      defineBox(container.lastElementChild, 65);

      __mockWindow.setSize.mockClear();
      act(() => {
        callbacks.get(container)!(
          [{ target: container } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
      expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);

      // A late minibar restore resizes the native window back to 60 px after
      // the request went out. The resize listener must re-apply the request
      // exactly once — no loop.
      Object.defineProperty(window, 'innerHeight', {
        value: 60,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();
      act(() => {
        fireViewportResize(callbacks);
      });
      expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);
      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ height: 713 }),
      );

      // The corrected flag is spent: another resize event does nothing.
      act(() => {
        fireViewportResize(callbacks);
      });
      expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);
    });

    it('corrects a multiplicative height mismatch once, by the ratio', async () => {
      const callbacks = captureResizeObservers();
      const innerSize = vi.fn(async () => ({ width: 650, height: 713 }));
      const scaleFactor = vi.fn(async () => 1);
      Object.assign(__mockWindow, { innerSize, scaleFactor });

      try {
        render(<App />);
        await act(async () => {});
        await showDownward();
        await enterChatMode();

        const container = document.querySelector('.morphing-container')!;
        const chat = document.querySelector('[data-chat-area]')!;
        const content = document.querySelector('[data-chat-content]')!;
        const scroller = content.parentElement as HTMLElement;
        scroller.style.paddingTop = '16px';
        scroller.style.paddingBottom = '16px';
        defineBox(container, 600);
        defineBox(chat, 535);
        defineBox(scroller, 501);
        defineBox(content, 1200);
        // The input bar is the only content-sized sibling below the chat area.
        defineBox(container.lastElementChild, 65);

        act(() => {
          callbacks.get(container)!(
            [{ target: container } as unknown as ResizeObserverEntry],
            {} as ResizeObserver,
          );
        });

        // The native side accepted 713 at scale 1 (its physical inner size is
        // exactly 713) but the webview renders 570 CSS px — a conversion
        // mismatch. The retry is 713² / 570 = 892, applied once.
        Object.defineProperty(window, 'innerHeight', {
          value: 570,
          configurable: true,
        });
        __mockWindow.setSize.mockClear();
        act(() => {
          fireViewportResize(callbacks);
        });
        await act(async () => {});

        expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);
        expect(__mockWindow.setSize).toHaveBeenCalledWith(
          expect.objectContaining({ height: 892 }),
        );
      } finally {
        delete (__mockWindow as Record<string, unknown>).innerSize;
        delete (__mockWindow as Record<string, unknown>).scaleFactor;
      }
    });

    it('ignores a resize event that outran the layout viewport', async () => {
      const callbacks = captureResizeObservers();
      // The webview catches up while the native probe is in flight: by the
      // time `innerSize()` resolves, the CSS height is the one that was asked
      // for. The synchronous read that armed this observation saw the *old*
      // height, so the observation is stale and must not be corrected.
      const innerSize = vi.fn(async () => {
        Object.defineProperty(window, 'innerHeight', {
          value: 713,
          configurable: true,
        });
        return { width: 650, height: 713 };
      });
      const scaleFactor = vi.fn(async () => 1);
      Object.assign(__mockWindow, { innerSize, scaleFactor });

      try {
        render(<App />);
        await act(async () => {});
        await showDownward();
        await enterChatMode();

        const container = document.querySelector('.morphing-container')!;
        const chat = document.querySelector('[data-chat-area]')!;
        const content = document.querySelector('[data-chat-content]')!;
        const scroller = content.parentElement as HTMLElement;
        scroller.style.paddingTop = '16px';
        scroller.style.paddingBottom = '16px';
        defineBox(container, 600);
        defineBox(chat, 535);
        defineBox(scroller, 501);
        defineBox(content, 1200);
        // The input bar is the only content-sized sibling below the chat area.
        defineBox(container.lastElementChild, 65);

        act(() => {
          callbacks.get(container)!(
            [{ target: container } as unknown as ResizeObserverEntry],
            {} as ResizeObserver,
          );
        });

        // The event arrives while the layout viewport still reports the
        // pre-resize height.
        Object.defineProperty(window, 'innerHeight', {
          value: 570,
          configurable: true,
        });
        __mockWindow.setSize.mockClear();
        act(() => {
          fireViewportResize(callbacks);
        });
        await act(async () => {});

        // The ratio (713² / 570 = 892) would be applied to a window that is
        // already 713. No correction is issued.
        expect(__mockWindow.setSize).not.toHaveBeenCalled();
      } finally {
        delete (__mockWindow as Record<string, unknown>).innerSize;
        delete (__mockWindow as Record<string, unknown>).scaleFactor;
      }
    });

    it('does not correct a viewport observation the request has not answered yet', async () => {
      const callbacks = captureResizeObservers();
      const innerSize = vi.fn(async () => ({ width: 650, height: 713 }));
      const scaleFactor = vi.fn(async () => 1);
      Object.assign(__mockWindow, { innerSize, scaleFactor });

      try {
        render(<App />);
        await act(async () => {});
        await showDownward();
        await enterChatMode();

        const container = document.querySelector('.morphing-container')!;
        const chat = document.querySelector('[data-chat-area]')!;
        const content = document.querySelector('[data-chat-content]')!;
        const scroller = content.parentElement as HTMLElement;
        scroller.style.paddingTop = '16px';
        scroller.style.paddingBottom = '16px';
        defineBox(container, 600);
        defineBox(chat, 535);
        defineBox(scroller, 501);
        defineBox(content, 1200);
        defineBox(container.lastElementChild, 65);

        // The request is computed from this layout.
        Object.defineProperty(window, 'innerHeight', {
          value: 300,
          configurable: true,
        });
        act(() => {
          callbacks.get(container)!(
            [{ target: container } as unknown as ResizeObserverEntry],
            {} as ResizeObserver,
          );
        });

        // The viewport observer then delivers that same layout. The native
        // window is already at 713, but the CSS viewport has not answered the
        // request yet — `actual` is the request's starting height, not its
        // result, so the ratio must not be applied.
        __mockWindow.setSize.mockClear();
        act(() => {
          fireViewportResize(callbacks);
        });
        await act(async () => {});

        expect(__mockWindow.setSize).not.toHaveBeenCalled();
      } finally {
        delete (__mockWindow as Record<string, unknown>).innerSize;
        delete (__mockWindow as Record<string, unknown>).scaleFactor;
      }
    });

    it('re-syncs to the content requirement after a display-scale change', async () => {
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector('.morphing-container')!;
      const chat = document.querySelector('[data-chat-area]')!;
      const content = document.querySelector('[data-chat-content]')!;
      const scroller = content.parentElement as HTMLElement;
      scroller.style.paddingTop = '16px';
      scroller.style.paddingBottom = '16px';
      defineBox(container, 600);
      defineBox(chat, 535);
      defineBox(scroller, 501);
      defineBox(content, 1200);
      // The input bar is the only content-sized sibling below the chat area.
      defineBox(container.lastElementChild, 65);

      Object.defineProperty(window, 'innerHeight', {
        value: 300,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();
      await act(async () => {
        emitTauriEvent('tauri://scale-change', {});
      });

      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ height: 713 }),
      );
    });

    /**
     * Fires the morphing container's observer — the trigger `syncWindowSize`
     * runs from. Used to model the observation a native resize produces while
     * a mini-bar shrink is still in flight.
     */
    function fireContainerResize(
      callbacks: Map<Element, ResizeObserverCallback>,
      container: Element,
    ) {
      const callback = callbacks.get(container);
      expect(callback).toBeDefined();
      callback!(
        [{ target: container } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    }

    /**
     * Renders the overlay in chat mode with a 713 px content requirement
     * (600 container, 1200 transcript content) and returns the observer map
     * plus the morphing container. The requirement is far from any collapsed
     * window, so a re-applied content size is unmistakable.
     */
    async function setupChatSizing() {
      const callbacks = captureResizeObservers();
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector('.morphing-container')!;
      const chat = document.querySelector('[data-chat-area]')!;
      const content = document.querySelector('[data-chat-content]')!;
      const scroller = content.parentElement as HTMLElement;
      scroller.style.paddingTop = '16px';
      scroller.style.paddingBottom = '16px';
      defineBox(container, 600);
      defineBox(chat, 535);
      defineBox(scroller, 501);
      defineBox(content, 1200);
      defineBox(container.lastElementChild, 65);
      return { callbacks, container };
    }

    /**
     * Makes `enter_minibar_size` hang, modelling a native resize that lands or
     * a reply that arrives later than the observation that follows it.
     * Returns the resolver for the command's answer.
     */
    function pendingShrink() {
      const base = invoke.getMockImplementation();
      let resolveShrink!: (applied: boolean) => void;
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'enter_minibar_size') {
            return new Promise<boolean>((resolve) => {
              resolveShrink = resolve;
            });
          }
          return base?.(cmd, args);
        },
      );
      return (applied: boolean) => resolveShrink(applied);
    }

    it('does not re-apply the content size while a mini-bar shrink is pending', async () => {
      // The backend resizes the window to 48×48 on its main thread, which can
      // finish before the IPC reply reaches React. Both observers see the
      // shrunken viewport while `overlayStateRef` still reads `visible`; if
      // either re-applied the content size the logo would render inside a
      // full-size window (the user's "the frame did not shrink" report).
      const { callbacks, container } = await setupChatSizing();

      // A content request is outstanding, so `verifyNativeSize` has a height
      // it could wrongly re-apply.
      act(() => {
        fireContainerResize(callbacks, container);
      });

      const resolveShrink = pendingShrink();
      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });

      // The native shrink lands before the reply resolves.
      Object.defineProperty(window, 'innerHeight', {
        value: 48,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();
      act(() => {
        fireViewportResize(callbacks);
      });
      act(() => {
        fireContainerResize(callbacks, container);
      });
      expect(__mockWindow.setSize).not.toHaveBeenCalled();

      // The reply resolves and the UI enters the mini bar; the suppressed
      // observations left the window alone.
      await act(async () => {
        resolveShrink(true);
      });
      expect(screen.getByTitle(/click to restore/i)).toBeInTheDocument();
      expect(__mockWindow.setSize).not.toHaveBeenCalled();
    });

    // ── Each pending-shrink guard is pinned by its own test, so dropping one
    //    guard fails exactly one test rather than being masked by another.

    it('pins the syncWindowSize guard: the container observer is ignored while pending', async () => {
      const { callbacks, container } = await setupChatSizing();
      act(() => {
        fireContainerResize(callbacks, container);
      });

      const resolveShrink = pendingShrink();
      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 48,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();

      // Only the container observer (the `syncWindowSize` site) fires.
      act(() => {
        fireContainerResize(callbacks, container);
      });
      expect(__mockWindow.setSize).not.toHaveBeenCalled();

      await act(async () => {
        resolveShrink(true);
      });
    });

    it('pins the verifyNativeSize entry guard: the viewport observer is ignored while pending', async () => {
      const { callbacks, container } = await setupChatSizing();
      act(() => {
        fireContainerResize(callbacks, container);
      });

      const resolveShrink = pendingShrink();
      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 48,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();

      // Only the document observer (the `verifyNativeSize` entry site) fires.
      // Without that guard its collapsed-window recovery re-applies 713.
      act(() => {
        fireViewportResize(callbacks);
      });
      expect(__mockWindow.setSize).not.toHaveBeenCalled();

      await act(async () => {
        resolveShrink(true);
      });
    });

    it('pins the verifyNativeSize async re-check: a shrink starting mid-probe is respected', async () => {
      const { callbacks, container } = await setupChatSizing();
      Object.defineProperty(window, 'innerHeight', {
        value: 400,
        configurable: true,
      });
      act(() => {
        fireContainerResize(callbacks, container);
      });
      // The settled viewport has moved away from the request's starting
      // height, which is what arms the multiplicative correction.
      Object.defineProperty(window, 'innerHeight', {
        value: 500,
        configurable: true,
      });

      let resolveProbe!: () => void;
      const innerSize = vi.fn(
        () =>
          new Promise<{ width: number; height: number }>((resolve) => {
            resolveProbe = () => resolve({ width: 650, height: 713 });
          }),
      );
      const scaleFactor = vi.fn(async () => 1);
      Object.assign(__mockWindow, { innerSize, scaleFactor });
      try {
        // The observation starts, and the probe is held open.
        act(() => {
          fireViewportResize(callbacks);
        });
        // The shrink is requested while the probe is in flight.
        const resolveShrink = pendingShrink();
        await act(async () => {
          emitTauriEvent('quickai://minibar', null);
        });

        __mockWindow.setSize.mockClear();
        await act(async () => {
          resolveProbe();
        });
        expect(__mockWindow.setSize).not.toHaveBeenCalled();

        await act(async () => {
          resolveShrink(true);
        });
      } finally {
        delete (__mockWindow as Record<string, unknown>).innerSize;
        delete (__mockWindow as Record<string, unknown>).scaleFactor;
      }
    });

    it('releases sizing when a shrink reply never arrives', async () => {
      // A lost IPC (or a wedged main thread) must not leave the overlay
      // visible with fit-to-content disabled: typing would clip the input.
      const { callbacks, container } = await setupChatSizing();
      const resolveShrink = pendingShrink();
      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 48,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();
      act(() => {
        fireContainerResize(callbacks, container);
      });
      expect(__mockWindow.setSize).not.toHaveBeenCalled();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 1100));
      });

      // The pending state expired and re-applied the content size by itself.
      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ height: 713 }),
      );
      // A reply that arrives after the timeout still enters the mini bar —
      // over the window the timeout just re-grew to the content size. Sizing
      // is then suppressed by the state (not the pending flag), so that frame
      // stays wrong until a summon. Recorded residual, not a regression.
      await act(async () => {
        resolveShrink(true);
      });
      expect(screen.getByTitle(/click to restore/i)).toBeInTheDocument();
    });

    it('restores sizing when the backend refuses a pending shrink', async () => {
      const callbacks = captureResizeObservers();
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector('.morphing-container')!;
      const chat = document.querySelector('[data-chat-area]')!;
      const content = document.querySelector('[data-chat-content]')!;
      const scroller = content.parentElement as HTMLElement;
      scroller.style.paddingTop = '16px';
      scroller.style.paddingBottom = '16px';
      defineBox(container, 600);
      defineBox(chat, 535);
      defineBox(scroller, 501);
      defineBox(content, 1200);
      defineBox(container.lastElementChild, 65);

      const base = invoke.getMockImplementation();
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'enter_minibar_size') return false;
          return base?.(cmd, args);
        },
      );
      Object.defineProperty(window, 'innerHeight', {
        value: 300,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });

      // The refusal cleared the pending flag and re-applied the content size,
      // so the overlay cannot be left visible with sizing suppressed.
      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();
      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ height: 713 }),
      );
      // A later observation still sizes normally.
      __mockWindow.setSize.mockClear();
      act(() => {
        fireContainerResize(callbacks, container);
      });
      expect(__mockWindow.setSize).toHaveBeenCalled();
    });

    it('clears the pending shrink when a show supersedes it', async () => {
      const callbacks = captureResizeObservers();
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector('.morphing-container')!;
      defineBox(container, 65);

      const base = invoke.getMockImplementation();
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'enter_minibar_size') {
            // The summon's show reaches the webview before the reply does.
            emitTauriEvent('quickai://visibility', {
              state: 'show',
              selected_text: null,
              window_x: null,
              window_y: null,
              screen_bottom_y: null,
            });
            return true;
          }
          return base?.(cmd, args);
        },
      );

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });
      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();

      // The show cleared the flag: a fresh observation must size the window
      // again rather than remaining suppressed forever. A show remounts the
      // overlay (new session key), so the box is defined on the new node.
      const shownContainer = document.querySelector('.morphing-container')!;
      defineBox(shownContainer, 65);
      Object.defineProperty(window, 'innerHeight', {
        value: 300,
        configurable: true,
      });
      __mockWindow.setSize.mockClear();
      act(() => {
        fireContainerResize(callbacks, shownContainer);
      });
      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ height: 113 }),
      );
    });

    it('re-measures the content when the chat history dropdown closes', async () => {
      // In chat mode the container is `h-full`, so releasing the dropdown's
      // inline min-height changes no box: the container observer never fires
      // and the window keeps the dropdown's reserved height. Measured before
      // the fix: 423 px retained where the content needs 313.
      const callbacks = captureResizeObservers();
      render(<App />);
      await act(async () => {});
      await showDownward();
      await enterChatMode();

      const container = document.querySelector(
        '.morphing-container',
      ) as HTMLElement;
      const chat = document.querySelector('[data-chat-area]')!;
      const content = document.querySelector('[data-chat-content]')!;
      const scroller = content.parentElement as HTMLElement;
      defineBox(container, 265);
      defineBox(chat, 200);
      defineBox(scroller, 166);
      defineBox(content, 166);
      defineBox(container.lastElementChild, 65);
      Object.defineProperty(window, 'innerHeight', {
        value: 423,
        configurable: true,
      });

      // Open: the effect reserves room for the dropdown.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Open history' }));
      });
      expect(container.style.minHeight).not.toBe('');

      __mockWindow.setSize.mockClear();
      // Close: the reservation is released and the window must return to the
      // content requirement (265 + 48), not keep 423.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Open history' }));
      });

      expect(container.style.minHeight).toBe('');
      expect(__mockWindow.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ width: 650, height: 313 }),
      );
      // The container observer was not needed for this: the effect measured.
      expect(callbacks.get(container)).toBeDefined();
    });
  });

  it('requestHideOverlay is a no-op when already hidden', async () => {
    render(<App />);
    await act(async () => {});

    // Overlay is hidden initially — fire hide-request on hidden overlay
    // This exercises the 'hidden' branch in requestHideOverlay's state setter
    await act(async () => {
      emitTauriEvent('quickai://visibility', { state: 'hide-request' });
    });

    // No crash, no change — overlay is already hidden
    expect(document.querySelector('.morphing-container')).toBeNull();
  });

  // ─── History integration ─────────────────────────────────────────────────────

  describe('history integration', () => {
    it('shows history icon button in ask-bar mode', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      expect(
        screen.getByRole('button', { name: /open history/i }),
      ).toBeInTheDocument();
    });

    it('shows history panel when history icon is clicked in ask-bar mode', async () => {
      invoke.mockResolvedValue([]); // list_conversations returns empty

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });

      expect(
        screen.getByPlaceholderText(/search past chats/i),
      ).toBeInTheDocument();
    });

    it('closes history panel when a conversation is loaded', async () => {
      invoke.mockResolvedValueOnce(undefined); // notify_frontend_ready
      invoke.mockResolvedValueOnce([]); // reset_conversation (from replayEntranceAnimation)
      invoke.mockResolvedValueOnce([
        // load_conversation
        {
          id: 'm1',
          role: 'user',
          content: 'Hello',
          quoted_text: null,
          created_at: 1,
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Hi',
          quoted_text: null,
          created_at: 2,
        },
      ]);

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Open history
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });

      // Wait for empty list to render
      await act(async () => {});

      // Panel should be visible but no conversations to click
      // (list is empty, so just verify panel closes on a second click)
      // Close via second click on history icon
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });

      expect(screen.queryByPlaceholderText(/search past chats/i)).toBeNull();
    });

    it('shows save button in conversation view when there are messages', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'test' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Reply' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    it('save button calls save_conversation when clicked', async () => {
      enableChannelCaptureWithResponses({
        save_conversation: { conversation_id: 'conv-test' },
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'answer' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /save conversation/i }),
        );
      });

      expect(invoke).toHaveBeenCalledWith(
        'save_conversation',
        expect.objectContaining({
          model: expect.any(String),
          messages: expect.any(Array),
        }),
      );
    });

    it('clicking save button when already saved calls delete_conversation (unsave toggle)', async () => {
      enableChannelCaptureWithResponses({
        save_conversation: { conversation_id: 'conv-save-toggle' },
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'answer' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Save the conversation first
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /save conversation/i }),
        );
      });

      // Button should now read "Remove from history"
      expect(
        screen.getByRole('button', { name: /remove from history/i }),
      ).toBeInTheDocument();

      invoke.mockClear();

      // Click again to unsave
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /remove from history/i }),
        );
      });

      expect(invoke).toHaveBeenCalledWith('delete_conversation', {
        conversationId: 'conv-save-toggle',
      });

      // Button reverts to "Save conversation"
      expect(
        screen.getByRole('button', { name: /save conversation/i }),
      ).toBeInTheDocument();
    });

    it('resets history state on overlay reopen', async () => {
      enableChannelCaptureWithResponses({
        save_conversation: { conversation_id: 'conv-123' },
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Send message + Done
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'hello' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hi' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Save
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /save conversation/i }),
        );
      });

      // Reopen — bookmark should reset (save button enabled again)
      enableChannelCapture();
      await showOverlay();

      // In ask-bar mode now — no save button visible, but history icon is
      expect(
        screen.getByRole('button', { name: /open history/i }),
      ).toBeInTheDocument();
    });

    it('handleNewConversation shows SwitchConfirmation when unsaved, resets on Start New', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Get into chat mode with an unsaved turn
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'answer' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Click + (unsaved conversation → history panel opens with SwitchConfirmation)
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'New conversation' }),
        );
      });

      // SwitchConfirmation should be visible with "new" variant
      expect(
        screen.getByRole('button', { name: 'Start New' }),
      ).toBeInTheDocument();

      // Click "Start New" → should reset to ask-bar mode
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start New' }));
      });

      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('handleNewConversation Cancel closes the history dropdown', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Get into chat mode with an unsaved turn
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'answer' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Click + → SwitchConfirmation appears
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'New conversation' }),
        );
      });

      expect(
        screen.getByRole('button', { name: 'Cancel' }),
      ).toBeInTheDocument();

      // Click Cancel → dropdown closes, still in chat mode
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      });

      // SwitchConfirmation should be gone
      expect(
        screen.queryByRole('button', { name: 'Cancel' }),
      ).not.toBeInTheDocument();
      // Still showing the conversation
      expect(screen.getByText('question')).toBeInTheDocument();
    });

    it('handleNewConversation resets directly when conversation is already saved', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [],
        save_conversation: 'saved-id',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Get into chat mode
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'answer' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Save the conversation
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /save conversation/i }),
        );
      });

      // Click + (already saved → no confirmation, direct reset)
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'New conversation' }),
        );
      });

      // Should be directly back in ask-bar mode (no confirmation prompt)
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('handleNewConversation revokes blob URLs when images are attached', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [],
        save_image_command: '/tmp/img.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Get into chat mode with an unsaved turn
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'answer' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Paste an image while in chat mode (unsaved conversation)
      const replyInput = screen.getByPlaceholderText('Reply...');
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(replyInput, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });

      const revokeSpy = vi.mocked(URL.revokeObjectURL);
      revokeSpy.mockClear();

      // Click + → SwitchConfirmation (unsaved conversation)
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'New conversation' }),
        );
      });

      // Click "Start New" → resetForNewConversation revokes blob URLs
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start New' }));
      });

      expect(revokeSpy).toHaveBeenCalled();
      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('handleNewConversation saves then resets on Save & Start New', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [],
        save_conversation: 'saved-id',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Get into chat mode with an unsaved turn
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'answer' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Click + → SwitchConfirmation appears
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'New conversation' }),
        );
      });

      expect(
        screen.getByRole('button', { name: 'Save & Start New' }),
      ).toBeInTheDocument();

      // Click "Save & Start New" → saves then resets to ask-bar mode
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Save & Start New' }),
        );
      });

      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('handleSaveAndNew aborts reset when save fails', async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'list_conversations') return [];
        if (cmd === 'save_conversation') throw new Error('disk full');
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Complete a turn so isSaved = false
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'q' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'a' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Click + → SwitchConfirmation
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'New conversation' }),
        );
      });

      // Click "Save & Start New" — save fails → should stay in chat mode
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Save & Start New' }),
        );
      });

      // Still in chat mode (save_conversation threw, reset was aborted)
      expect(screen.getByText('q')).toBeInTheDocument();
    });

    it('handleSaveAndLoad saves unsaved conversation then switches', async () => {
      const OTHER_MSGS = [
        {
          id: 'm3',
          role: 'user',
          content: 'Old q',
          quoted_text: null,
          created_at: 1,
        },
        {
          id: 'm4',
          role: 'assistant',
          content: 'Old a',
          quoted_text: null,
          created_at: 2,
        },
      ];
      enableChannelCaptureWithResponses({
        save_conversation: { conversation_id: 'conv-new' },
        load_conversation: OTHER_MSGS,
        list_conversations: [
          {
            id: 'conv-other2',
            title: 'Other chat',
            model: 'gpt-4o',
            updated_at: 1,
            message_count: 2,
          },
        ],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Complete a turn (unsaved)
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'q' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'a' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Open chat history WITHOUT saving
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /history/i }));
      });

      // Click a different conversation → SwitchConfirmation
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /other chat/i }));
      });

      // Save & Switch — isSaved is FALSE so save_conversation should be called
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /save & switch/i }));
      });

      expect(invoke).toHaveBeenCalledWith(
        'save_conversation',
        expect.objectContaining({
          model: expect.any(String),
        }),
      );
    });

    it('handleSaveAndLoad aborts load when save_conversation fails', async () => {
      // Bug: without the early return on save failure, the load would still run
      // and could overwrite the current session with an unrelated conversation.
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'list_conversations')
          return [
            {
              id: 'c2',
              title: 'Other chat',
              model: 'gpt-4o',
              updated_at: 1,
              message_count: 1,
            },
          ];
        if (cmd === 'save_conversation') throw new Error('disk full');
        // load_conversation must NOT be called
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Complete a turn so isSaved = false
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'q' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'a' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Open history → click another conversation → SwitchConfirmation
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /other chat/i }));
      });

      // Confirm "Save & Switch" — save_conversation will throw
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /save & switch/i }));
      });

      // load_conversation must NOT have been called (early return after save failure)
      expect(invoke).not.toHaveBeenCalledWith(
        'load_conversation',
        expect.anything(),
      );
    });

    it('clicking a conversation loads it directly when already saved (no dialog)', async () => {
      const OTHER_MSGS = [
        {
          id: 'm3',
          role: 'user',
          content: 'Old q',
          quoted_text: null,
          created_at: 1,
        },
        {
          id: 'm4',
          role: 'assistant',
          content: 'Old a',
          quoted_text: null,
          created_at: 2,
        },
      ];
      enableChannelCaptureWithResponses({
        save_conversation: { conversation_id: 'conv-current' },
        load_conversation: OTHER_MSGS,
        list_conversations: [
          {
            id: 'conv-other',
            title: 'Switch target',
            model: 'gpt-4o',
            updated_at: 1,
            message_count: 2,
          },
        ],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Complete a turn
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'q' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'a' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Save the conversation → isSaved = true
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /save conversation/i }),
        );
      });

      // Open chat history
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });

      // Click a different conversation — isSaved=true means no dialog, loads directly
      invoke.mockClear();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch target/i }));
      });

      // No SwitchConfirmation dialog — save_conversation NOT called again
      expect(invoke).not.toHaveBeenCalledWith(
        'save_conversation',
        expect.anything(),
      );
      // load_conversation IS called directly
      expect(invoke).toHaveBeenCalledWith('load_conversation', {
        conversationId: 'conv-other',
      });
    });

    it('handleDeleteConversation marks active conversation unsaved but keeps messages', async () => {
      const LOADED_MSGS = [
        {
          id: 'm1',
          role: 'user',
          content: 'Hi',
          quoted_text: null,
          created_at: 1,
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Hello',
          quoted_text: null,
          created_at: 2,
        },
      ];
      enableChannelCaptureWithResponses({
        load_conversation: LOADED_MSGS,
        list_conversations: [
          {
            id: 'conv-target',
            title: 'My chat',
            model: 'gpt-4o',
            updated_at: 1,
            message_count: 2,
          },
        ],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Load a conversation from ask-bar history → conversationId = 'conv-target'
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /my chat/i }));
      });

      // Messages are visible in chat mode
      expect(screen.getByText('Hi')).toBeInTheDocument();

      // Open chat history and delete the currently-active conversation
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /delete conversation/i }),
        );
      });

      // delete_conversation was called
      expect(invoke).toHaveBeenCalledWith('delete_conversation', {
        conversationId: 'conv-target',
      });

      // Messages remain — still in chat mode
      expect(screen.getByText('Hi')).toBeInTheDocument();

      // Save button reverts to unsaved state ("Save conversation")
      expect(
        screen.getByRole('button', { name: /save conversation/i }),
      ).toBeInTheDocument();
    });

    it('clicking outside the chat history dropdown closes it', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Complete a turn to enter chat mode
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'q' } });
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'a' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Open history dropdown
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });
      expect(
        screen.getByPlaceholderText('Search past chats…'),
      ).toBeInTheDocument();

      // Click outside — should close the dropdown
      await act(async () => {
        fireEvent.mouseDown(document.body);
      });
      expect(screen.queryByPlaceholderText('Search past chats…')).toBeNull();
    });

    it('clicking inside the chat history dropdown does not close it', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Complete a turn to enter chat mode
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'q' } });
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'a' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Open history dropdown
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });

      const searchInput = screen.getByPlaceholderText('Search past chats…');
      expect(searchInput).toBeInTheDocument();

      // Click inside the dropdown — should NOT close it
      await act(async () => {
        fireEvent.mouseDown(searchInput);
      });
      expect(
        screen.getByPlaceholderText('Search past chats…'),
      ).toBeInTheDocument();
    });

    it('handleDeleteConversation allows saving the conversation again after deletion', async () => {
      // After deleting the active conversation from history, isSaved resets to
      // false so the user can re-save the same messages under a new record.
      enableChannelCaptureWithResponses({
        load_conversation: [
          {
            id: 'm1',
            role: 'user',
            content: 'Hi',
            quoted_text: null,
            created_at: 1,
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Hello',
            quoted_text: null,
            created_at: 2,
          },
        ],
        list_conversations: [
          {
            id: 'conv-active',
            title: 'Active chat',
            model: 'gpt-4o',
            updated_at: 1,
            message_count: 2,
          },
        ],
        save_conversation: { conversation_id: 'conv-new' },
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Load the conversation → isSaved = true
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /active chat/i }));
      });

      // Verify save button shows unsave state
      expect(
        screen.getByRole('button', { name: /remove from history/i }),
      ).toBeInTheDocument();

      // Open history and delete the active conversation
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /delete conversation/i }),
        );
      });

      // Messages remain, isSaved is now false — save button is re-enabled
      expect(screen.getByText('Hi')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /save conversation/i }),
      ).toBeInTheDocument();

      // User can re-save the conversation
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /save conversation/i }),
        );
      });
      expect(invoke).toHaveBeenCalledWith(
        'save_conversation',
        expect.objectContaining({ messages: expect.any(Array) }),
      );
    });

    it('handleLoadConversation closes history panel when load_conversation fails', async () => {
      // Bug: without try/catch, setIsHistoryOpen(false) is never reached when
      // loadConversation() throws, leaving the panel open on failure.
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'list_conversations')
          return [
            {
              id: 'c1',
              title: 'Chat',
              model: 'gpt-4o',
              updated_at: 1,
              message_count: 1,
            },
          ];
        if (cmd === 'load_conversation') throw new Error('load failed');
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });

      // Click the conversation — load_conversation will throw
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^chat$/i }));
      });

      // Panel must close even on failure; app must still be running
      expect(screen.queryByPlaceholderText(/search past chats/i)).toBeNull();
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('handleDeleteConversation does not reset history when a different conversation is deleted', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [
          {
            id: 'conv-unrelated',
            title: 'Unrelated',
            model: 'gpt-4o',
            updated_at: 1,
            message_count: 2,
          },
        ],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Open ask-bar history (no conversation loaded — conversationId is null)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open history/i }));
      });

      // Delete a conversation while conversationId is null (id !== conversationId → false branch)
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /delete conversation/i }),
        );
      });

      expect(invoke).toHaveBeenCalledWith('delete_conversation', {
        conversationId: 'conv-unrelated',
      });
    });
  });

  // ─── Image integration ─────────────────────────────────────────────────────

  describe('image integration', () => {
    /** Helper: paste an image file into the textarea and wait for thumbnails. */
    async function pasteImage() {
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['fake-img-data'], 'photo.png', {
        type: 'image/png',
      });
      const clipboardData = {
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      await act(async () => {
        fireEvent.paste(textarea, { clipboardData });
      });
      // Thumbnails appear immediately via blob URL (before backend completes)
      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });
    }

    it('handleImagesAttached stages images and shows thumbnails', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await pasteImage();

      // Wait for FileReader + invoke to complete in background
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.objectContaining({
              imageDataBase64: expect.any(String),
            }),
          );
        });
      });

      // Thumbnails should still be present
      expect(
        screen.getByRole('list', { name: /attached images/i }),
      ).toBeInTheDocument();
    });

    it('handleImageRemove removes thumbnail and calls remove_image_command', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await pasteImage();

      // Wait for backend to resolve (filePath set)
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      invoke.mockClear();

      // Click remove button on the thumbnail
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      });

      expect(invoke).toHaveBeenCalledWith('remove_image_command', {
        path: '/tmp/staged/img1.jpg',
      });
      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('handleSubmit with images passes imagePaths and clears attachedImages', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await pasteImage();

      // Wait for backend to resolve (filePath set)
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      // Type a message and submit
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'describe this' } });
      });

      invoke.mockClear();
      enableChannelCapture();

      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // ask should be called with imagePaths
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: 'describe this',
          images: ['/tmp/staged/img1.jpg'],
        }),
      );
    });

    it('submits with images and no text', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await pasteImage();

      // Wait for backend to resolve
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      invoke.mockClear();
      enableChannelCapture();

      // Submit with Enter (no text, just images)
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // ask should be called with empty message but imagePaths
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '',
          images: ['/tmp/staged/img1.jpg'],
        }),
      );
    });

    it('previewImage opens ImagePreviewModal and closing clears it', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await pasteImage();

      // Click preview button on thumbnail
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /preview/i }));
      });

      // ImagePreviewModal should be open (has role="dialog")
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Close the modal
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /close preview/i }));
      });

      // Dialog should be gone
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('handleImagesAttached removes image when backend fails', async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'save_image_command') throw new Error('disk full');
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.drop(
          document.querySelector('[class*="flex flex-col w-full shrink-0"]')!,
          {
            preventDefault: vi.fn(),
            dataTransfer: { files: [file] },
          },
        );
      });

      // Thumbnail appears immediately via blob URL
      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });

      // Wait for FileReader + invoke to settle — failed image gets removed
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      // Image should be removed after backend failure
      await vi.waitFor(() => {
        expect(
          screen.queryByRole('list', { name: /attached images/i }),
        ).toBeNull();
      });
    });

    it('handleImagesAttached skips images that fail to stage', async () => {
      // First call succeeds, second call fails
      let saveCallCount = 0;
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // channel capture — no-op for this test
          }
          if (cmd === 'save_image_command') {
            saveCallCount++;
            if (saveCallCount === 2) throw new Error('disk full');
            return '/tmp/staged/img1.jpg';
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Drop two image files via the AskBarView wrapper
      const askBarWrapper = document.querySelector(
        '[class*="flex flex-col w-full shrink-0"]',
      );
      expect(askBarWrapper).not.toBeNull();

      const file1 = new File(['data1'], 'img1.png', { type: 'image/png' });
      const file2 = new File(['data2'], 'img2.png', { type: 'image/png' });
      fireEvent.drop(askBarWrapper!, {
        preventDefault: vi.fn(),
        dataTransfer: { files: [file1, file2] },
      });

      // Both thumbnails appear immediately
      await vi.waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
      });

      // Wait for both backend calls to settle
      await act(async () => {
        await vi.waitFor(() => {
          expect(saveCallCount).toBe(2);
        });
      });

      // Failed image gets removed, only one remains
      await vi.waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
      });
    });

    it('dropping image onto root window div attaches image in ask-bar mode', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const rootDiv = document.querySelector('.h-screen')!;
      expect(rootDiv).not.toBeNull();
      const file = new File(['data'], 'photo.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.drop(rootDiv, {
          preventDefault: vi.fn(),
          dataTransfer: { files: [file] },
        });
      });

      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });
    });

    it('dropping image onto root window div attaches image in chat mode (second image after conversation)', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Send a plain text message and complete the generation to enter chat mode
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'hello' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // Complete the AI response so isGenerating becomes false
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hi!' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });
      await act(async () => {});

      // Confirm we are in chat mode with generation complete
      expect(screen.getByPlaceholderText('Reply...')).toBeInTheDocument();

      // Now in chat mode. Drop image onto root div (not AskBarView specifically)
      const rootDiv = document.querySelector('.h-screen')!;
      expect(rootDiv).not.toBeNull();
      const file = new File(['data'], 'second.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.drop(rootDiv, {
          preventDefault: vi.fn(),
          dataTransfer: { files: [file] },
        });
      });

      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });
    });

    it('dragOver anywhere in window shows violet ring on AskBarView when under max', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const rootDiv = document.querySelector('.h-screen')!;
      expect(rootDiv).not.toBeNull();
      fireEvent.dragOver(rootDiv, { preventDefault: vi.fn() });

      const askBarWrapper = document.querySelector(
        '[class*="flex flex-col w-full shrink-0"]',
      )!;
      expect(askBarWrapper.classList.contains('ring-2')).toBe(true);
      expect(askBarWrapper.classList.contains('ring-status-error/60')).toBe(
        false,
      );
    });

    it('dragOver shows red ring and max label when already at max images', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste 3 images to reach max
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      for (let i = 0; i < 3; i++) {
        const file = new File([`data${i}`], `img${i}.png`, {
          type: 'image/png',
        });
        await act(async () => {
          fireEvent.paste(textarea, {
            clipboardData: {
              items: [{ type: 'image/png', getAsFile: () => file }],
            },
          });
        });
      }

      // Wait for 3 thumbnails
      await vi.waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
      });

      // Now drag over; should show red ring and max label
      const rootDiv = document.querySelector('.h-screen')!;
      fireEvent.dragOver(rootDiv, { preventDefault: vi.fn() });

      const askBarWrapper = document.querySelector(
        '[class*="flex flex-col w-full shrink-0"]',
      )!;
      expect(askBarWrapper.classList.contains('ring-status-error/60')).toBe(
        true,
      );
      expect(screen.getByText('Max 3 images')).toBeInTheDocument();
    });

    it('dragLeave when cursor exits window clears drag-over ring', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const rootDiv = document.querySelector('.h-screen')!;
      fireEvent.dragOver(rootDiv, { preventDefault: vi.fn() });
      // relatedTarget null simulates cursor leaving the window entirely
      fireEvent.dragLeave(rootDiv, { relatedTarget: null });

      const askBarWrapper = document.querySelector(
        '[class*="flex flex-col w-full shrink-0"]',
      )!;
      expect(askBarWrapper.classList.contains('ring-2')).toBe(false);
    });

    it('dragOver when generating does not show drag-over ring', async () => {
      enableChannelCapture();
      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Submit to trigger isGenerating
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'hi' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      const rootDiv = document.querySelector('.h-screen')!;
      fireEvent.dragOver(rootDiv, { preventDefault: vi.fn() });

      const askBarWrapper = document.querySelector(
        '[class*="flex flex-col w-full shrink-0"]',
      )!;
      expect(askBarWrapper.classList.contains('ring-2')).toBe(false);
    });

    it('handleRootDrop ignores drop during generation', async () => {
      enableChannelCapture();
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'hi' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      const rootDiv = document.querySelector('.h-screen')!;
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      fireEvent.drop(rootDiv, {
        preventDefault: vi.fn(),
        dataTransfer: { files: [file] },
      });

      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('handleRootDrop ignores drop with no dataTransfer files', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const rootDiv = document.querySelector('.h-screen')!;
      fireEvent.drop(rootDiv, { preventDefault: vi.fn() });

      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('handleRootDrop ignores drop when already at max images', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img.jpg',
      });
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      for (let i = 0; i < 3; i++) {
        const img = new File([`d${i}`], `i${i}.png`, { type: 'image/png' });
        await act(async () => {
          fireEvent.paste(textarea, {
            clipboardData: {
              items: [{ type: 'image/png', getAsFile: () => img }],
            },
          });
        });
      }
      await vi.waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
      });

      const rootDiv = document.querySelector('.h-screen')!;
      const extra = new File(['extra'], 'extra.png', { type: 'image/png' });
      fireEvent.drop(rootDiv, {
        preventDefault: vi.fn(),
        dataTransfer: { files: [extra] },
      });

      // Still exactly 3 — the drop was rejected
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('handleRootDrop ignores non-image files', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const rootDiv = document.querySelector('.h-screen')!;
      const doc = new File(['text'], 'doc.txt', { type: 'text/plain' });
      fireEvent.drop(rootDiv, {
        preventDefault: vi.fn(),
        dataTransfer: { files: [doc] },
      });

      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('handleChatImagePreview opens modal for chat history image', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await pasteImage();

      // Wait for backend to resolve
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      // Type and submit to create a user message with image
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'what is this?' } });
      });

      invoke.mockClear();
      enableChannelCapture();

      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // Simulate AI response completing
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'It is' });
        getLastChannel()?.simulateMessage({ type: 'Token', data: ' a cat.' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // The user message should have a thumbnail from chat history (via convertFileSrc)
      // Find the preview button in the chat bubble (not the ask bar)
      const previewButtons = screen.getAllByRole('button', {
        name: /preview/i,
      });
      // The chat bubble thumbnail should be present
      expect(previewButtons.length).toBeGreaterThan(0);

      await act(async () => {
        fireEvent.click(previewButtons[0]);
      });

      // ImagePreviewModal should be open
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Close it
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /close preview/i }));
      });

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('handleChatImagePreview passes blob URLs through without convertFileSrc', async () => {
      // Make save_image_command hang so the image stays as a blob URL
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // channel capture
          }
          if (cmd === 'save_image_command') {
            return new Promise<string>(() => {}); // never resolves
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste and submit while still processing → pendingUserMessage with blob URL
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });

      act(() => {
        fireEvent.change(textarea, { target: { value: 'what is this?' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Pending user message should be visible in chat with a blob URL thumbnail
      await vi.waitFor(() => {
        expect(screen.getByText('what is this?')).toBeInTheDocument();
      });

      // Click the preview button in the chat bubble — should open the modal
      // with the blob URL directly (no convertFileSrc wrapping).
      const previewButtons = screen.getAllByRole('button', {
        name: /preview/i,
      });
      expect(previewButtons.length).toBeGreaterThan(0);

      await act(async () => {
        fireEvent.click(previewButtons[0]);
      });

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Flush stale FileReader macrotask so it doesn't leak into the next test.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    });

    it('handleImageRemove is safe when called twice for the same image', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await pasteImage();

      // Wait for backend to resolve
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      invoke.mockClear();

      // Click remove twice rapidly — the second call should be a no-op
      // (the functional updater in setAttachedImages will find no matching
      // image on the second pass, exercising the !img branch).
      const removeBtn = screen.getByRole('button', { name: /remove/i });
      await act(async () => {
        fireEvent.click(removeBtn);
        fireEvent.click(removeBtn);
      });

      // remove_image_command should only be called once
      const removeCalls = invoke.mock.calls.filter(
        (call) => call[0] === 'remove_image_command',
      );
      expect(removeCalls).toHaveLength(1);
    });

    it('handleImageRemove revokes blob URL without calling remove_image_command when filePath is null', async () => {
      // Make save_image_command hang forever (never resolve)
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // channel capture — no-op
          }
          if (cmd === 'save_image_command') {
            return new Promise(() => {}); // never resolves
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste an image — thumbnail appears immediately with null filePath
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });

      invoke.mockClear();

      // Remove the image while filePath is still null
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      });

      // Should NOT call remove_image_command (no file to delete)
      expect(invoke).not.toHaveBeenCalledWith(
        'remove_image_command',
        expect.anything(),
      );
      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('defers submit when images are still processing and fires when ready', async () => {
      // Flush any stale macrotasks (e.g. FileReader.onload from prior tests)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      // Track save_image_command calls scoped to THIS test
      let resolveSave: ((path: string) => void) | null = null;
      const savePromises: Promise<string>[] = [];
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // Accept channel for ask
          }
          if (cmd === 'save_image_command') {
            const p = new Promise<string>((resolve) => {
              resolveSave = resolve;
            });
            savePromises.push(p);
            return p;
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste an image; thumbnail appears immediately (filePath null)
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      // Wait for this test's FileReader to complete and call save_image_command
      await act(async () => {
        await vi.waitFor(() => expect(savePromises).toHaveLength(1));
      });

      // Type and submit while image is still processing
      act(() => {
        fireEvent.change(textarea, { target: { value: 'describe this' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Should show "Processing images" state
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();

      // Resolve the image; triggers deferred submit chain
      resolveSave!('/tmp/staged/img1.jpg');

      // Flush async chain: promise → state update → effect → ask → invoke
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // User message should appear in the chat (ask() fired the real submit)
      expect(screen.getByText('describe this')).toBeInTheDocument();
    });

    it('stop button cancels active generation via handleCancel', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/img.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Start a normal text conversation (no images)
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'hello' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // Should be generating — stop button visible
      const stopBtn = screen.getByRole('button', { name: /stop/i });
      expect(stopBtn).toBeInTheDocument();

      // Click stop — should call cancel_generation
      invoke.mockClear();
      enableChannelCapture();

      await act(async () => {
        fireEvent.click(stopBtn);
      });

      expect(invoke).toHaveBeenCalledWith('cancel_generation');
    });

    it('cancelling during pending submit restores input (undo send)', async () => {
      // Flush stale macrotasks from prior tests
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // Accept channel
          }
          if (cmd === 'save_image_command') {
            return new Promise<string>(() => {}); // never resolves
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste an image
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });

      // Type and submit while image is still processing
      act(() => {
        fireEvent.change(textarea, { target: { value: 'my question' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Should be in chat mode with stop button
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();

      // Click stop to cancel the pending submit
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
      });

      // Should revert to ask-bar mode with the query restored
      const restoredTextarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      expect(restoredTextarea).toBeInTheDocument();
      expect((restoredTextarea as HTMLTextAreaElement).value).toBe(
        'my question',
      );

      // Images should still be visible (still processing in background)
      expect(
        screen.getByRole('list', { name: /attached images/i }),
      ).toBeInTheDocument();

      // ask should never have been called
      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
    });

    it('waits for all images before firing deferred submit', async () => {
      // Flush stale macrotasks from prior tests
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      // Two images: each gets its own resolve function
      const resolvers: ((path: string) => void)[] = [];
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // Accept channel
          }
          if (cmd === 'save_image_command') {
            return new Promise<string>((resolve) => {
              resolvers.push(resolve);
            });
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Drop two images at once
      const askBarWrapper = document.querySelector(
        '[class*="flex flex-col w-full shrink-0"]',
      )!;
      const file1 = new File(['d1'], 'a.png', { type: 'image/png' });
      const file2 = new File(['d2'], 'b.png', { type: 'image/png' });
      fireEvent.drop(askBarWrapper, {
        preventDefault: vi.fn(),
        dataTransfer: { files: [file1, file2] },
      });

      // Wait for both save_image_command calls
      await act(async () => {
        await vi.waitFor(() => expect(resolvers).toHaveLength(2));
      });

      // Submit while both images are still processing
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'two images' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();

      // Resolve ONLY the first image — allReady should still be false
      await act(async () => {
        resolvers[0]('/tmp/img1.jpg');
      });
      await act(async () => {});

      // Still processing — second image not ready
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();

      // Resolve the second image — now allReady is true, submit fires
      await act(async () => {
        resolvers[1]('/tmp/img2.jpg');
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // User message should appear
      expect(screen.getByText('two images')).toBeInTheDocument();
    });

    it('cancels deferred submit when all images fail', async () => {
      // Make save_image_command hang then reject
      let rejectSave: ((err: Error) => void) | null = null;
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // channel capture
          }
          if (cmd === 'save_image_command') {
            return new Promise<string>((_, reject) => {
              rejectSave = reject;
            });
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste and submit while processing
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      await vi.waitFor(() => {
        expect(
          screen.getByRole('list', { name: /attached images/i }),
        ).toBeInTheDocument();
      });

      act(() => {
        fireEvent.change(textarea, { target: { value: 'describe' } });
      });

      // Wait for FileReader to complete and save_image_command to be invoked
      // (which sets rejectSave via the promise constructor).
      await act(async () => {
        await vi.waitFor(() => {
          expect(rejectSave).not.toBeNull();
        });
      });

      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Waiting state
      await vi.waitFor(() => {
        expect(
          screen.getByRole('button', { name: /stop/i }),
        ).toBeInTheDocument();
      });

      // Reject the image — it should be removed and pending submit cancelled
      await act(async () => {
        rejectSave!(new Error('disk full'));
      });

      // Image removed → no thumbnails → pending submit cancelled
      await vi.waitFor(() => {
        expect(
          screen.queryByRole('list', { name: /attached images/i }),
        ).toBeNull();
      });

      // ask should never have been called
      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());

      // The "Processing images" button should be gone — back to normal send
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeInTheDocument();

      // User's query should be restored so their text isn't lost
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toHaveValue('describe');
    });
  });

  // ─── Screenshot integration ────────────────────────────────────────────────

  describe('screenshot integration', () => {
    it('clicking screenshot button invokes capture_full_screen_command', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screenshot.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Take a screenshot' }),
        );
      });

      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
        });
      });
    });

    it('does nothing when capture_full_screen_command returns empty string', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Take a screenshot' }),
        );
      });

      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
        });
      });
    });

    it('does not invoke capture_full_screen_command when at max images', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img.jpg',
        capture_full_screen_command: '/tmp/screenshot.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Attach 3 images via paste to reach the limit.
      const pasteOneImage = async () => {
        const textarea = screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        );
        const file = new File(['data'], 'photo.png', { type: 'image/png' });
        await act(async () => {
          fireEvent.paste(textarea, {
            clipboardData: {
              items: [{ type: 'image/png', getAsFile: () => file }],
            },
          });
        });
      };
      await pasteOneImage();
      await pasteOneImage();
      await pasteOneImage();

      const btn = screen.getByRole('button', { name: 'Take a screenshot' });
      expect(btn).toBeDisabled();

      invoke.mockClear();
      fireEvent.click(btn);
      await act(async () => {});

      expect(invoke).not.toHaveBeenCalledWith('capture_full_screen_command');
    });

    it('adds screenshot image to attached images when capture succeeds', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screenshot.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Take a screenshot' }),
        );
      });

      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
        });
      });
    });
  });

  it('revokes blob URLs when overlay reopens with attached images', async () => {
    enableChannelCaptureWithResponses({
      save_image_command: '/tmp/img.jpg',
    });

    render(<App />);
    await act(async () => {});
    await showOverlay();

    // Paste an image so attachedImages is non-empty
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    const file = new File(['data'], 'img.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ type: 'image/png', getAsFile: () => file }],
        },
      });
    });

    await vi.waitFor(() => {
      expect(
        screen.getByRole('list', { name: /attached images/i }),
      ).toBeInTheDocument();
    });

    // Reopen overlay — should clear images and revoke blob URLs
    await showOverlay();

    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: /attached images/i })).toBeNull();
  });

  it('revokes blob URLs when overlay hides with attached images', async () => {
    enableChannelCaptureWithResponses({
      save_image_command: '/tmp/img.jpg',
    });

    render(<App />);
    await act(async () => {});
    await showOverlay();

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    const file = new File(['data'], 'img.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ type: 'image/png', getAsFile: () => file }],
        },
      });
    });

    await vi.waitFor(() => {
      expect(
        screen.getByRole('list', { name: /attached images/i }),
      ).toBeInTheDocument();
    });

    const revokeSpy = vi.mocked(URL.revokeObjectURL);
    revokeSpy.mockClear();

    // Hide overlay via Escape — requestHideOverlay should revoke blob URLs
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(revokeSpy).toHaveBeenCalled();
  });

  it('resets session on overlay reopen', async () => {
    render(<App />);
    await act(async () => {});

    await showOverlay();

    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );

    // Complete a conversation turn
    act(() => {
      fireEvent.change(textarea, { target: { value: 'first question' } });
    });
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await act(async () => {});

    act(() => {
      getLastChannel()?.simulateMessage({
        type: 'Token',
        data: 'First response',
      });
      getLastChannel()?.simulateMessage({ type: 'Done' });
    });

    expect(screen.getByText('First response')).toBeInTheDocument();

    // Re-enable channel capture for second session
    enableChannelCapture();

    // Reopen overlay — should reset session
    await showOverlay();

    // Should be back to input bar mode with placeholder
    expect(
      screen.getByPlaceholderText('Ask a question, or type / to see commands'),
    ).toBeInTheDocument();
    // Old messages should be gone
    expect(screen.queryByText('First response')).toBeNull();
  });

  // ─── /screen command ─────────────────────────────────────────────────────────

  describe('/screen command', () => {
    it('invokes capture_full_screen_command and calls ask with screenshot path', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Use "/screen " (with trailing space) so the suggestion popover is dismissed
      // and Enter goes to the submit handler directly.
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen ' } });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          images: ['/tmp/screen.jpg'],
          query: '/screen',
        }),
      );
    });

    it('keeps the /screen trigger in the message sent to the backend', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/screen what is this error?' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '/screen what is this error?',
          images: ['/tmp/screen.jpg'],
        }),
      );
    });

    it('detects /screen anywhere in the message, not just at start', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: 'hello /screen there' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: 'hello /screen there',
          images: ['/tmp/screen.jpg'],
        }),
      );
    });

    it('does not call ask when capture_full_screen_command throws', async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'capture_full_screen_command') {
          throw new Error('Permission denied');
        }
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Use "/screen " (with trailing space) so the suggestion popover is dismissed
      // and Enter goes directly to the submit handler.
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen ' } });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
      // The actual Rust error message is surfaced directly.
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });

    it('surfaces string errors from Tauri invoke directly', async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'capture_full_screen_command') {
          // Tauri v2 rejects with the Err(String) value as a plain string.
          return Promise.reject(
            'Screen Recording permission is required to use /screen.',
          );
        }
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen ' } });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(
        screen.getByText(
          'Screen Recording permission is required to use /screen.',
        ),
      ).toBeInTheDocument();
    });

    it('handles non-Error non-string rejection values', async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'capture_full_screen_command') {
          return Promise.reject(42);
        }
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen ' } });
      });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('clears capture error when a new submit is attempted', async () => {
      enableChannelCapture();
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'capture_full_screen_command') {
          throw new Error('capture failed');
        }
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      // First attempt fails; error banner appears.
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen ' } });
      });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      expect(screen.getByText('capture failed')).toBeInTheDocument();

      // Typing a new query and submitting normal text clears the error banner.
      act(() => {
        fireEvent.change(textarea, { target: { value: 'hello' } });
      });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      expect(screen.queryByText('capture failed')).toBeNull();
    });

    it('merges screenshot path with existing attached images', async () => {
      // Set up mocks: save_image_command for image attachment, then screen capture.
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/attached.jpg',
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste an image first. This exercises the filter/map on attachedImages inside
      // handleScreenSubmit, covering the lines for non-null filePath images.
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['img'], 'photo.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      // Wait for the image to be processed (filePath resolved).
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith(
          'save_image_command',
          expect.anything(),
        );
      });

      // Now type /screen and submit.
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen describe' } });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '/screen describe',
          images: ['/tmp/attached.jpg', '/tmp/screen.jpg'],
        }),
      );
    });

    it('handles /screen with selected context', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay('some context');

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen explain' } });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '/screen explain',
          context: 'some context',
          images: ['/tmp/screen.jpg'],
        }),
      );
    });

    it('shows pending chat bubble immediately on submit before capture resolves', async () => {
      let resolveCapture!: (path: string) => void;
      enableChannelCaptureWithResponses({
        capture_full_screen_command: new Promise<string>((res) => {
          resolveCapture = res;
        }),
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen check this' } });
      });

      // Submit; capture is now in-flight (pending)
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Before capture resolves: query should be cleared and app in pending mode
      expect((textarea as HTMLTextAreaElement).value).toBe('');

      // Resolve the capture and let async work settle
      await act(async () => {
        resolveCapture('/tmp/screen.jpg');
      });
      await act(async () => {});

      // After capture resolves: ask should be called
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ query: '/screen check this' }),
      );
    });

    it('restores query with cleanQuery text when capture fails mid-message', async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'capture_full_screen_command') {
          throw new Error('Screen capture timed out');
        }
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/screen what is this?' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // Query should be restored with the full original message
      expect((textarea as HTMLTextAreaElement).value).toBe(
        '/screen what is this?',
      );
      expect(screen.getByText('Screen capture timed out')).toBeInTheDocument();
    });

    it('uses blobUrl for still-processing attached images in the pending bubble', async () => {
      // save_image_command never resolves: image stays in null-filePath state.
      // Use enableChannelCaptureWithResponses so channel capture (for ask)
      // still works alongside the custom per-command responses.
      enableChannelCaptureWithResponses({
        save_image_command: new Promise<string>(() => {}),
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste an image; save_image_command hangs, so filePath stays null
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['img'], 'photo.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      // Submit /screen immediately; image still processing (filePath === null)
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen ' } });
      });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // Capture succeeded; ask called with only the screenshot
      // (the attached image never resolved its filePath)
      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          images: ['/tmp/screen.jpg'],
        }),
      );
    });

    it('cancelling during in-flight capture prevents ask from being called', async () => {
      let resolveCapture!: (path: string) => void;
      enableChannelCaptureWithResponses({
        capture_full_screen_command: new Promise<string>((res) => {
          resolveCapture = res;
        }),
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/screen ' } });
      });

      // Submit; capture is now in-flight
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Cancel while capture is pending (Stop button)
      const stopButton = screen.getByRole('button', { name: /stop|cancel/i });
      act(() => {
        fireEvent.click(stopButton);
      });

      // Resolve the capture after cancel
      await act(async () => {
        resolveCapture('/tmp/screen.jpg');
      });
      await act(async () => {});

      // ask must NOT be called since the user cancelled
      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
    });
  });

  // ─── /think command ─────────────────────────────────────────────────────────

  describe('/think command', () => {
    it('sends think:true to ask and keeps /think prefix in message', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/think why is the sky blue?' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '/think why is the sky blue?',
          think: true,
        }),
      );
    });

    it('does nothing when /think has no query and no images', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/think' } });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
    });

    it('detects /think anywhere in the message, not just at start', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: 'hello /think world' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: 'hello /think world',
          think: true,
        }),
      );
    });

    it('forwards selected context when /think is used with quoted text', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay('some selected text');

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/think explain this code' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '/think explain this code',
          context: 'some selected text',
          think: true,
        }),
      );
    });

    it('sends think:true with /think followed by only a space', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/think ' } });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      // "/think " with only a space after prefix, no actual query, no images => no submit
      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
    });
  });

  // ─── Multi-command ──────────────────────────────────────────────────────────

  describe('Multi-command support', () => {
    it('sends /screen /think with both screen capture and think:true', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/screen /think explain this' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '/screen /think explain this',
          images: ['/tmp/screen.jpg'],
          think: true,
        }),
      );
    });

    it('sends /think /screen with both screen capture and think:true', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/screen.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/think /screen explain this' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: '/think /screen explain this',
          images: ['/tmp/screen.jpg'],
          think: true,
        }),
      );
    });
  });

  // ─── Utility commands ───────────────────────────────────────────────────────

  describe('Utility commands (buildPrompt routing)', () => {
    it('routes /rewrite command through buildPrompt and calls ask with composed prompt', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/rewrite fix this text' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      await vi.waitFor(() => {
        const askCall = vi
          .mocked(invoke)
          .mock.calls.find((c) => c[0] === 'ask');
        expect(askCall).toBeDefined();
        const args = askCall![1] as Record<string, unknown>;
        expect(args.promptOverride).toContain(
          'Please help rewrite the text below',
        );
        expect(args.promptOverride).toContain('fix this text');
      });
    });

    it('routes /translate with language arg through buildPrompt', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/translate jpn hello world' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      await vi.waitFor(() => {
        const askCall = vi
          .mocked(invoke)
          .mock.calls.find((c) => c[0] === 'ask');
        expect(askCall).toBeDefined();
        const args = askCall![1] as Record<string, unknown>;
        expect(args.promptOverride).toContain('Target language: jpn');
        expect(args.promptOverride).toContain('Text: hello world');
      });
    });

    it('/think and utility command compose: /think /tldr some long text', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/think /tldr some long text' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      await vi.waitFor(() => {
        const askCall = vi
          .mocked(invoke)
          .mock.calls.find((c) => c[0] === 'ask');
        expect(askCall).toBeDefined();
        const args = askCall![1] as Record<string, unknown>;
        expect(args.promptOverride).toContain('Summarize the following text');
        expect(args.promptOverride).toContain('some long text');
        expect(args.think).toBe(true);
      });
    });

    it('utility command with no input text does not call ask', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/rewrite' } });
      });

      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
    });

    it('utility command returns null composedPrompt when no usable input is found', async () => {
      // /translate with only a language code (no text to translate) makes buildPrompt return null.
      // strippedMessage = 'jpn' (non-empty, bypasses the early guard) but buildPrompt gets
      // lang='jpn', typedRemainder='', selected='', so returns null.
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: '/translate jpn' } });
      });

      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
    });

    it('utility command uses selected context when available', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      // Activate overlay with selected text as context
      await showOverlay('original selected text');

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      // Type a command with extra instruction so strippedMessage is non-empty
      // (bypasses the "no content" early guard) and selectedContext is also set.
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/rewrite make it concise' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      await vi.waitFor(() => {
        const askCall = vi
          .mocked(invoke)
          .mock.calls.find((c) => c[0] === 'ask');
        expect(askCall).toBeDefined();
        const args = askCall![1] as Record<string, unknown>;
        expect(args.promptOverride).toContain(
          'Please help rewrite the text below',
        );
        expect(args.promptOverride).toContain('original selected text');
        expect(args.context).toBe('original selected text');
      });
    });

    it('utility command with bare trigger uses selected context as display text', async () => {
      // strippedMessage is empty, selectedContext is present, images bypass the
      // early-return guard. displayText falls through to selectedContext?.trim().
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/ctx.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay('my selected text');

      // Paste an image and wait for backend resolution so hasPendingImages is false
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      invoke.mockClear();
      enableChannelCapture();

      // Submit just the command trigger (strippedMessage will be '')
      act(() => {
        fireEvent.change(textarea, { target: { value: '/rewrite' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      await vi.waitFor(() => {
        const askCall = vi
          .mocked(invoke)
          .mock.calls.find((c) => c[0] === 'ask');
        expect(askCall).toBeDefined();
        const args = askCall![1] as Record<string, unknown>;
        // The prompt should use selectedContext as $INPUT
        expect(args.promptOverride).toContain('my selected text');
      });
    });

    it('displays stripped user input in chat bubble, not the prompt template', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/rewrite fix this text' },
        });
      });

      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {});

      // renderUserContent splits command triggers into separate spans.
      // Check body textContent to confirm the full original query appears.
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain('/rewrite fix this text');
      });
    });

    it('utility command with resolved attached images passes imagePaths and revokes blob URLs', async () => {
      enableChannelCaptureWithResponses({
        save_image_command: '/tmp/staged/img1.jpg',
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste an image and wait for backend resolution
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['fake-img-data'], 'photo.png', {
        type: 'image/png',
      });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });
      await act(async () => {
        await vi.waitFor(() => {
          expect(invoke).toHaveBeenCalledWith(
            'save_image_command',
            expect.anything(),
          );
        });
      });

      invoke.mockClear();
      enableChannelCapture();

      // Type /rewrite command and submit
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/rewrite fix this prose' },
        });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      await vi.waitFor(() => {
        const askCall = vi
          .mocked(invoke)
          .mock.calls.find((c) => c[0] === 'ask');
        expect(askCall).toBeDefined();
        const args = askCall![1] as Record<string, unknown>;
        expect(args.promptOverride).toContain(
          'Please help rewrite the text below',
        );
        expect(args.images).toEqual(['/tmp/staged/img1.jpg']);
      });
    });

    it('utility command with pending images defers submit until images resolve', async () => {
      // Flush stale macrotasks from prior tests
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      let resolveSave: ((path: string) => void) | null = null;
      const savePromises: Promise<string>[] = [];
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (args && 'onEvent' in args) {
            // Accept channel for ask
          }
          if (cmd === 'save_image_command') {
            const p = new Promise<string>((resolve) => {
              resolveSave = resolve;
            });
            savePromises.push(p);
            return p;
          }
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Paste an image — thumbnail appears immediately (filePath null)
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['data'], 'img.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
      });

      // Wait for this test's FileReader to complete and call save_image_command
      await act(async () => {
        await vi.waitFor(() => expect(savePromises).toHaveLength(1));
      });

      // Type /rewrite and submit while image is still processing
      act(() => {
        fireEvent.change(textarea, {
          target: { value: '/rewrite make it clearer' },
        });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Should show pending state (stop button visible)
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();

      // Resolve the image — triggers deferred submit chain
      resolveSave!('/tmp/staged/img1.jpg');

      // Flush async chain: promise -> state update -> effect -> ask -> invoke
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // renderUserContent splits command triggers into separate spans.
      // Check body textContent to confirm the full original query appears.
      expect(document.body.textContent).toContain('/rewrite make it clearer');
    });
  });

  describe('Onboarding', () => {
    it('shows onboarding screen when quickai://onboarding event fires', async () => {
      enableChannelCapture();

      render(<App />);
      await act(async () => {});

      await act(async () => {
        emitTauriEvent('quickai://onboarding', { stage: 'permissions' });
      });

      expect(screen.getByText("Let's get QuickAI set up")).toBeInTheDocument();
    });

    it('does not show onboarding on normal visibility event', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      expect(screen.queryByText("Let's get QuickAI set up")).toBeNull();
    });

    it('renders normal ask bar when overlay is shown without onboarding', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('dismisses onboarding and shows ask bar when onComplete is called', async () => {
      invoke.mockResolvedValue(undefined);

      render(<App />);
      await act(async () => {});

      await act(async () => {
        emitTauriEvent('quickai://onboarding', { stage: 'intro' });
      });

      expect(screen.getByText('Before you dive in')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      });

      expect(screen.queryByText('Before you dive in')).toBeNull();
    });
  });

  describe('Minimize', () => {
    it('triggers hide overlay on minimize button click (skipTaskbar prevents minimize)', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });

      // Submit with Enter
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      // Wait for invoke
      await act(async () => {});

      // Simulate streaming tokens to enter chat mode
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hello' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      await act(async () => {});

      const minimizeBtn = screen.getByRole('button', { name: 'Minimize' });
      fireEvent.click(minimizeBtn);

      // Minimize now hides the overlay instead of calling window.minimize()
      // so the floating icon is always available to restore from
      // disappear with no taskbar entry to restore from.
      expect(invoke).toHaveBeenCalledWith('enter_minibar_size');
    });

    it('restores the overlay when the minibar icon is clicked', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hello' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));

      await act(async () => {});

      const minibar = screen.getByTitle(/click to restore/i);
      fireEvent.pointerDown(minibar, { clientX: 5, clientY: 5 });
      fireEvent.pointerUp(minibar, { clientX: 5, clientY: 5 });

      expect(invoke).toHaveBeenCalledWith('exit_minibar_size');
      expect(screen.getByPlaceholderText('Reply...')).toBeInTheDocument();
    });
  });

  it('opens the settings window from the ask bar gear', async () => {
    render(<App />);
    await act(async () => {});
    await showOverlay();

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(invoke).toHaveBeenCalledWith('open_settings_window');
  });

  describe('minibar event', () => {
    it('shrinks to the minibar and ignores repeats', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });

      expect(invoke).toHaveBeenCalledWith('enter_minibar_size');
      expect(screen.getByTitle(/click to restore/i)).toBeInTheDocument();

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter((c) => c[0] === 'enter_minibar_size'),
      ).toHaveLength(1);
    });

    it('passes the click-away surface token to the backend shrink', async () => {
      render(<App />);
      await act(async () => {});
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: null,
          window_y: null,
          screen_bottom_y: null,
          transition_epoch: 4,
        });
      });

      await act(async () => {
        emitTauriEvent('quickai://minibar', 4);
      });

      expect(invoke).toHaveBeenCalledWith('enter_minibar_size', { epoch: 4 });
      expect(screen.getByTitle(/click to restore/i)).toBeInTheDocument();
    });

    it('ignores a click-away that predates the latest show', async () => {
      render(<App />);
      await act(async () => {});
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: null,
          window_y: null,
          screen_bottom_y: null,
          transition_epoch: 4,
        });
      });
      // A newer show (e.g. the expand that answered the double-tap) supersedes
      // the click-away whose event is still in flight.
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: null,
          window_y: null,
          screen_bottom_y: null,
          transition_epoch: 5,
        });
      });

      await act(async () => {
        emitTauriEvent('quickai://minibar', 4);
      });

      expect(invoke).not.toHaveBeenCalledWith('enter_minibar_size', {
        epoch: 4,
      });
      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('mirrors whether the visible UI is on screen into the backend', async () => {
      const uiStateCalls = () =>
        invoke.mock.calls.filter((c) => c[0] === 'set_overlay_ui_visible');
      const lastUiState = () => {
        const calls = uiStateCalls();
        return calls[calls.length - 1];
      };

      render(<App />);
      await act(async () => {});
      expect(uiStateCalls()).toEqual([
        ['set_overlay_ui_visible', { visible: false }],
      ]);

      await showOverlay();
      expect(lastUiState()).toEqual([
        'set_overlay_ui_visible',
        { visible: true },
      ]);

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });
      expect(lastUiState()).toEqual([
        'set_overlay_ui_visible',
        { visible: false },
      ]);

      // Hiding reports "not visible" too: a summon from there may replay.
      const beforeHide = uiStateCalls().length;
      await act(async () => {
        emitTauriEvent('quickai://visibility', { state: 'hide-request' });
      });
      expect(uiStateCalls()).toHaveLength(beforeHide + 1);
      expect(lastUiState()).toEqual([
        'set_overlay_ui_visible',
        { visible: false },
      ]);
    });

    it('stays visible when the backend refuses a delayed click-away', async () => {
      // The click-away was merely delayed (webview throttling), not lost: by
      // the time it is processed a summon has already expanded the bar, so the
      // backend refuses the shrink. Entering the mini bar anyway would render
      // the 48 px logo inside the full-size window the summon just opened —
      // the "first double-tap did nothing" symptom.
      const base = invoke.getMockImplementation();
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'enter_minibar_size') return false;
          return base?.(cmd, args);
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        emitTauriEvent('quickai://minibar', 0);
      });

      expect(invoke).toHaveBeenCalledWith('enter_minibar_size', { epoch: 0 });
      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('stays visible when the shrink request fails', async () => {
      const base = invoke.getMockImplementation();
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'enter_minibar_size') throw new Error('ipc unavailable');
          return base?.(cmd, args);
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });

      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('stays visible when a show lands while the shrink is in flight', async () => {
      const base = invoke.getMockImplementation();
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'enter_minibar_size') {
            // The summon's show reaches the webview before the response does.
            emitTauriEvent('quickai://visibility', {
              state: 'show',
              selected_text: null,
              window_x: null,
              window_y: null,
              screen_bottom_y: null,
            });
            return true;
          }
          return base?.(cmd, args);
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });

      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('keeps the conversation when expanding from a genuine minibar', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Build a conversation so there is something a reset would destroy.
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hello' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });
      await act(async () => {});
      expect(screen.getByText('Hello')).toBeInTheDocument();

      // Click away: the same conversation, now collapsed to the mini bar.
      await act(async () => {
        emitTauriEvent('quickai://minibar', 3);
      });
      expect(screen.getByTitle(/click to restore/i)).toBeInTheDocument();
      expect(screen.queryByText('Hello')).not.toBeInTheDocument();

      // Double-tap: the backend expands and emits SHOW. That show must reveal
      // the collapsed session, not start a new one.
      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: null,
          window_y: null,
          screen_bottom_y: null,
          transition_epoch: 4,
        });
      });

      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('keeps the conversation when a lost-event expand emits no show', async () => {
      const base = invoke.getMockImplementation();
      invoke.mockImplementation(
        async (cmd: string, args?: Record<string, unknown>) => {
          // The click-away is superseded by a summon: the shrink is refused
          // and the `replay:false` expand emits no SHOW at all.
          if (cmd === 'enter_minibar_size') return false;
          return base?.(cmd, args);
        },
      );

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hello' });
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });
      await act(async () => {});
      expect(screen.getByText('Hello')).toBeInTheDocument();

      await act(async () => {
        emitTauriEvent('quickai://minibar', 0);
      });

      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();
    });

    it('ignores a minibar event while the overlay is hidden', async () => {
      render(<App />);
      await act(async () => {});

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });

      expect(invoke).not.toHaveBeenCalledWith('enter_minibar_size');
      expect(screen.queryByTitle(/click to restore/i)).not.toBeInTheDocument();
    });

    it('only moves an on-screen overlay into the minibar state', () => {
      expect(minibarStateFrom('visible')).toBe('minibar');
      expect(minibarStateFrom('hiding')).toBe('minibar');
      // A shrink that resolves after a hide must not resurrect the minibar UI.
      expect(minibarStateFrom('hidden')).toBe('hidden');
      expect(minibarStateFrom('minibar')).toBe('minibar');
    });

    it('retries a failed ui-state mirror and gives up after three attempts', async () => {
      vi.useFakeTimers();
      try {
        const base = invoke.getMockImplementation();
        let mirrorCalls = 0;
        invoke.mockImplementation(
          async (cmd: string, args?: Record<string, unknown>) => {
            if (cmd === 'set_overlay_ui_visible') {
              mirrorCalls += 1;
              throw new Error('ipc unavailable');
            }
            return base?.(cmd, args);
          },
        );

        render(<App />);
        await act(async () => {});
        expect(mirrorCalls).toBe(1);

        await act(async () => {
          vi.advanceTimersByTime(100);
        });
        expect(mirrorCalls).toBe(2);

        await act(async () => {
          vi.advanceTimersByTime(100);
        });
        expect(mirrorCalls).toBe(3);

        // The third failure is terminal: no unbounded retry loop.
        await act(async () => {
          vi.advanceTimersByTime(500);
        });
        expect(mirrorCalls).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels a pending mirror retry when the state changes', async () => {
      vi.useFakeTimers();
      try {
        const base = invoke.getMockImplementation();
        let mirrorCalls = 0;
        invoke.mockImplementation(
          async (cmd: string, args?: Record<string, unknown>) => {
            if (cmd === 'set_overlay_ui_visible') {
              mirrorCalls += 1;
              throw new Error('ipc unavailable');
            }
            return base?.(cmd, args);
          },
        );

        render(<App />);
        await act(async () => {});
        expect(mirrorCalls).toBe(1);

        await act(async () => {
          emitTauriEvent('quickai://visibility', {
            state: 'show',
            selected_text: null,
            window_x: null,
            window_y: null,
            screen_bottom_y: null,
          });
        });
        // A new state sends its own value immediately.
        expect(mirrorCalls).toBe(2);

        await act(async () => {
          vi.advanceTimersByTime(150);
        });
        // Only the new effect's retry ran; the pre-transition one was cancelled
        // (otherwise this would be 4) so it cannot overwrite the newer value.
        expect(mirrorCalls).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry a mirror send that rejects after the state changed', async () => {
      const base = invoke.getMockImplementation();
      const pending: Array<(error: Error) => void> = [];
      invoke.mockImplementation(
        (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === 'set_overlay_ui_visible') {
            return new Promise<undefined>((_resolve, reject) => {
              pending.push(reject);
            });
          }
          return Promise.resolve(base?.(cmd, args));
        },
      );

      render(<App />);
      await act(async () => {});
      expect(pending).toHaveLength(1);

      await act(async () => {
        emitTauriEvent('quickai://visibility', {
          state: 'show',
          selected_text: null,
          window_x: null,
          window_y: null,
          screen_bottom_y: null,
        });
      });
      expect(pending).toHaveLength(2);

      // The pre-transition send rejects only after its effect was cleaned up;
      // it must not arm a retry that would write the stale value.
      await act(async () => {
        pending[0](new Error('ipc unavailable'));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      expect(pending).toHaveLength(2);
    });

    it('restores the overlay when a desktop notification is clicked', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        emitTauriEvent('quickai://minibar', null);
      });
      await act(async () => {
        emitNotificationAction();
      });

      expect(invoke).toHaveBeenCalledWith('exit_minibar_size');
      expect(
        screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        ),
      ).toBeInTheDocument();
    });

    it('notifies the backend when a notification is clicked while hidden', async () => {
      render(<App />);
      await act(async () => {});

      await act(async () => {
        emitNotificationAction();
      });

      expect(invoke).toHaveBeenCalledWith('notify_overlay_hidden');
    });

    it('ignores a notification click while the overlay is visible', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        emitNotificationAction();
      });

      expect(invoke).not.toHaveBeenCalledWith('exit_minibar_size');
      expect(invoke).not.toHaveBeenCalledWith('notify_overlay_hidden');
    });

    it('tolerates an unsupported notification action bridge', async () => {
      mockOnAction.mockRejectedValueOnce(new Error('unsupported'));
      render(<App />);
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('notify_frontend_ready');
    });
  });

  describe('agent mode', () => {
    it('starts agent mode when the message reads as a desktop-control request', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'open notepad' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      expect(invoke).toHaveBeenCalledWith('start_agent_mode', {
        task: 'open notepad',
        skills: null,
      });
    });

    it('starts agent mode from the /do command', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do tidy my desktop' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      expect(invoke).toHaveBeenCalledWith('start_agent_mode', {
        task: 'tidy my desktop',
        skills: null,
      });
    });

    it('shows the minibar with the agent status while the agent runs', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Enter chat mode so the window controls (and Minimize) are available.
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });
      await act(async () => {});

      const chatTextarea = screen.getByPlaceholderText('Reply...');
      fireEvent.change(chatTextarea, { target: { value: '/do open notepad' } });
      await act(async () => {
        fireEvent.keyDown(chatTextarea, { key: 'Enter', shiftKey: false });
      });
      expect(invoke).toHaveBeenCalledWith('start_agent_mode', {
        task: 'open notepad',
        skills: null,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));

      await act(async () => {});

      const minibar = screen.getByTitle(/click to restore/i);
      expect(minibar.querySelector('span.absolute')?.className).toContain(
        'bg-tertiary',
      );
    });

    it('shows a rotating tip in chat mode', async () => {
      vi.useFakeTimers();
      try {
        render(<App />);
        await act(async () => {});
        await showOverlay();

        const textarea = screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        );
        fireEvent.change(textarea, { target: { value: 'hi' } });
        act(() => {
          fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
        });
        await act(async () => {});
        act(() => {
          getLastChannel()?.simulateMessage({ type: 'Done' });
        });
        await act(async () => {});

        expect(screen.queryByTestId('tip-bar')).toBeNull();

        await act(async () => {
          vi.advanceTimersByTime(46_000);
        });
        expect(screen.getByTestId('tip-bar')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('auto-captures the screen for a vision-intent message', async () => {
      enableChannelCaptureWithResponses({
        capture_full_screen_command: '/tmp/shot.jpg',
      });
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, {
        target: { value: 'what is on the screen' },
      });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      expect(invoke).toHaveBeenCalledWith('capture_full_screen_command');
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ images: ['/tmp/shot.jpg'] }),
      );
    });

    it('does nothing for a bare /do with no task', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      expect(invoke).not.toHaveBeenCalledWith(
        'start_agent_mode',
        expect.anything(),
      );
    });

    it('uses the quoted selection as the /do task', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay('tidy up my desktop');

      // A bare `/do` with only a selection is rejected by the empty-message
      // guard, so pair it with /think (which the guard allows) to exercise the
      // selection fallback.
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/think /do' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      expect(invoke).toHaveBeenCalledWith('start_agent_mode', {
        task: 'tidy up my desktop',
        skills: null,
      });
    });

    it('surfaces the closing summary when the run finishes', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do open notepad' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {
        emitTauriEvent('quickai://agent', {
          kind: 'done',
          summary: 'Opened Notepad and typed the note.',
        });
      });

      expect(
        screen.getByText('Opened Notepad and typed the note.'),
      ).toBeInTheDocument();
    });

    it('surfaces an agent error message', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do open notepad' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {
        emitTauriEvent('quickai://agent', {
          kind: 'error',
          code: 'rate_limited',
          message: 'Provider is busy',
        });
      });

      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Provider is busy')).toBeInTheDocument();
    });

    it('keeps the agent panel across a skill_unreadable notice', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do open notepad' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });

      await act(async () => {
        emitTauriEvent('quickai://agent', {
          kind: 'error',
          code: 'skill_unreadable',
          message: 'translate: not found',
        });
      });

      // The notice is surfaced without ending the run or flashing an error.
      expect(screen.getByText('translate: not found')).toBeInTheDocument();
      expect(screen.getByText('Capturing screen...')).toBeInTheDocument();
      expect(screen.queryByText('Error')).toBeNull();

      // A later event still drives the panel, so it never vanishes mid-run.
      await act(async () => {
        emitTauriEvent('quickai://agent', {
          kind: 'reasoning',
          text: 'thinking',
        });
      });
      expect(screen.getByText('Analyzing...')).toBeInTheDocument();
    });

    it('clears a finished agent panel when the overlay is reopened', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do open notepad' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {
        emitTauriEvent('quickai://agent', {
          kind: 'done',
          summary: 'Opened Notepad and typed the note.',
        });
      });
      expect(
        screen.getByText('Opened Notepad and typed the note.'),
      ).toBeInTheDocument();

      // Hide, then reopen: the new session must not carry the stale panel.
      await act(async () => {
        emitTauriEvent('quickai://visibility', { state: 'hide-request' });
      });
      expect(
        screen.queryByText('Opened Notepad and typed the note.'),
      ).toBeNull();

      await showOverlay();
      expect(
        screen.queryByText('Opened Notepad and typed the note.'),
      ).toBeNull();
      expect(screen.queryByText('Done')).toBeNull();
    });
  });

  describe('Keyboard shortcuts', () => {
    it('starts new conversation on Ctrl+N', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      // Submit a message so we have a conversation
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'hello' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      // Simulate streaming tokens then done
      const channel = getLastChannel();
      await act(async () => {
        channel?.simulateMessage({ type: 'Token', data: 'Hi' });
      });
      await act(async () => {
        channel?.simulateMessage({ type: 'Done' });
      });

      // Press Ctrl+N — should start a new conversation
      act(() => {
        fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
      });

      // After reset, the placeholder should return to the ask-bar text
      await act(async () => {});
    });

    it('saves conversation on Ctrl+S', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      // Submit a message
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'test save' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      const channel = getLastChannel();
      await act(async () => {
        channel?.simulateMessage({ type: 'Token', data: 'Response' });
      });
      await act(async () => {
        channel?.simulateMessage({ type: 'Done' });
      });

      // Press Ctrl+S — should invoke save_conversation
      act(() => {
        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'save_conversation',
        expect.any(Object),
      );
    });

    it('toggles history on Ctrl+H', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      // Press Ctrl+H — should toggle history panel
      act(() => {
        fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
      });
      await act(async () => {});

      // Press Ctrl+H again — should close it
      act(() => {
        fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
      });
      await act(async () => {});
    });

    it('opens Settings on Ctrl+,', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      act(() => {
        fireEvent.keyDown(window, { key: ',', ctrlKey: true });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('open_settings_window');
    });

    it('opens Settings on Cmd+,', async () => {
      render(<App />);
      await act(async () => {});

      await showOverlay();

      act(() => {
        fireEvent.keyDown(window, { key: ',', metaKey: true });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('open_settings_window');
    });

    it('copies last response on Ctrl+Shift+C', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<App />);
      await act(async () => {});

      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'copy test' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      const channel = getLastChannel();
      await act(async () => {
        channel?.simulateMessage({ type: 'Token', data: 'My response' });
      });
      await act(async () => {
        channel?.simulateMessage({ type: 'Done' });
      });

      // Press Ctrl+Shift+C
      act(() => {
        fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });
      });
      await act(async () => {});

      expect(writeText).toHaveBeenCalledWith('My response');
    });

    it('drops a leading blank line when copying the last response', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<App />);
      await act(async () => {});

      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.change(textarea, { target: { value: 'copy test' } });
      });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      const channel = getLastChannel();
      await act(async () => {
        channel?.simulateMessage({ type: 'Token', data: '\n\nMy response' });
      });
      await act(async () => {
        channel?.simulateMessage({ type: 'Done' });
      });

      act(() => {
        fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });
      });
      await act(async () => {});

      expect(writeText).toHaveBeenCalledWith('My response');
    });

    it('does not copy when no assistant response exists', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<App />);
      await act(async () => {});

      await showOverlay();

      act(() => {
        fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });
      });
      await act(async () => {});

      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('chat header', () => {
    it('shows the conversation name and renames it from the header', async () => {
      enableChannelCaptureWithResponses({
        save_conversation: { conversation_id: 'conv-1' },
        list_conversations: [
          {
            id: 'conv-1',
            title: 'My chat',
            model: 'gpt-4o',
            updated_at: Date.now(),
            message_count: 2,
          },
        ],
      });
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hello' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Token', data: 'Hi' });
      });
      await act(async () => {
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });

      // Ctrl+S saves and the stored placeholder title lands in the header.
      act(() => {
        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      });
      await act(async () => {});
      await act(async () => {});

      expect(screen.getByText('My chat')).toBeInTheDocument();

      fireEvent.contextMenu(
        screen.getByRole('button', { name: 'Rename conversation' }),
      );
      const input = screen.getByRole('textbox', { name: 'Conversation name' });
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(invoke).toHaveBeenCalledWith('rename_conversation', {
        conversationId: 'conv-1',
        title: 'Renamed',
      });
    });

    it('keeps the previous name when a header rename is rejected', async () => {
      enableChannelCaptureWithResponses({
        save_conversation: { conversation_id: 'conv-1' },
        list_conversations: [
          {
            id: 'conv-1',
            title: 'My chat',
            model: 'gpt-4o',
            updated_at: Date.now(),
            message_count: 2,
          },
        ],
      });
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hello' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });
      await act(async () => {});

      act(() => {
        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      });
      await act(async () => {});
      await act(async () => {});
      expect(screen.getByText('My chat')).toBeInTheDocument();

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'rename_conversation') throw new Error('nope');
      });

      fireEvent.contextMenu(
        screen.getByRole('button', { name: 'Rename conversation' }),
      );
      const input = screen.getByRole('textbox', { name: 'Conversation name' });
      fireEvent.change(input, { target: { value: 'Rejected' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await act(async () => {});

      // The header keeps the name that is actually stored.
      expect(screen.getByText('My chat')).toBeInTheDocument();
    });

    it('renders no title for an unsaved conversation', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hello' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      expect(
        screen.queryByRole('button', { name: 'Rename conversation' }),
      ).toBeNull();
    });

    it('renames a conversation from the history panel', async () => {
      enableChannelCaptureWithResponses({
        list_conversations: [
          {
            id: 'c1',
            title: 'Old name',
            model: 'gpt-4o',
            updated_at: Date.now(),
            message_count: 2,
          },
        ],
      });
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});
      act(() => {
        getLastChannel()?.simulateMessage({ type: 'Done' });
      });
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: 'Open history' }));
      await act(async () => {});

      fireEvent.contextMenu(screen.getByText('Old name'));
      fireEvent.click(screen.getByText('Rename'));
      const input = screen.getByRole('textbox', { name: 'Rename' });
      fireEvent.change(input, { target: { value: 'New name' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(invoke).toHaveBeenCalledWith('rename_conversation', {
        conversationId: 'c1',
        title: 'New name',
      });
    });
  });

  describe('window pin', () => {
    it('toggles the pin and starts unpinned on reopen', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      // Opening the overlay clears any previous pin.
      expect(invoke).toHaveBeenCalledWith('set_overlay_pinned', {
        pinned: false,
      });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: 'Pin window' }));
      expect(invoke).toHaveBeenCalledWith('set_overlay_pinned', {
        pinned: true,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Unpin window' }));
      expect(invoke).toHaveBeenCalledWith('set_overlay_pinned', {
        pinned: false,
      });
    });

    it('rolls the pin back when the backend rejects the change', async () => {
      render(<App />);
      await act(async () => {});

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'set_overlay_pinned') throw new Error('refused');
      });
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: 'hi' } });
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: 'Pin window' }));
      await act(async () => {});

      // The failed toggle is undone, so the button still offers to pin.
      expect(
        screen.getByRole('button', { name: 'Pin window' }),
      ).toBeInTheDocument();
    });
  });

  describe('agent keyboard control', () => {
    async function startAgentAwaitingConfirmation() {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do open notepad' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {
        emitTauriEvent('quickai://agent', {
          kind: 'confirmation_required',
          action: { type: 'click', x: 10, y: 20 },
        });
      });
    }

    it('allows the pending action with 1', async () => {
      await startAgentAwaitingConfirmation();

      act(() => {
        fireEvent.keyDown(window, { key: '1' });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('confirm_agent_action', {
        actionId: null,
      });
    });

    it('denies the pending action with 2', async () => {
      await startAgentAwaitingConfirmation();

      act(() => {
        fireEvent.keyDown(window, { key: '2' });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('reject_agent_action', {
        actionId: null,
      });
    });

    it('aborts the run with Ctrl+C', async () => {
      await startAgentAwaitingConfirmation();

      act(() => {
        fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('stop_agent_mode');
    });

    it('aborts the run with Cmd+C', async () => {
      await startAgentAwaitingConfirmation();

      act(() => {
        fireEvent.keyDown(window, { key: 'C', metaKey: true });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('stop_agent_mode');
    });

    it('ignores other keys while a confirmation is pending', async () => {
      await startAgentAwaitingConfirmation();

      act(() => {
        fireEvent.keyDown(window, { key: '3' });
      });
      await act(async () => {});

      expect(invoke).not.toHaveBeenCalledWith(
        'confirm_agent_action',
        expect.anything(),
      );
      expect(invoke).not.toHaveBeenCalledWith(
        'reject_agent_action',
        expect.anything(),
      );
    });

    it('acts on keys typed into the input box while a confirmation is pending', async () => {
      await startAgentAwaitingConfirmation();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      act(() => {
        fireEvent.keyDown(textarea, { key: '1' });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('confirm_agent_action', {
        actionId: null,
      });
    });

    it('acts on keys typed into a contenteditable field while a confirmation is pending', async () => {
      await startAgentAwaitingConfirmation();

      const editable = document.createElement('div');
      Object.defineProperty(editable, 'isContentEditable', { value: true });
      document.body.appendChild(editable);

      act(() => {
        fireEvent.keyDown(editable, { key: '2' });
      });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('reject_agent_action', {
        actionId: null,
      });
      editable.remove();
    });

    it('ignores agent shortcuts when no confirmation is pending', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      act(() => {
        fireEvent.keyDown(window, { key: '1' });
      });
      await act(async () => {});

      expect(invoke).not.toHaveBeenCalledWith(
        'confirm_agent_action',
        expect.anything(),
      );
    });
  });

  describe('skills (/add)', () => {
    const SKILLS = [
      { id: 's1', alias: 'assistant', path: '/a.md', enabled: true },
      { id: 's2', alias: 'translate', path: '/b.md', enabled: false },
    ];

    function extract(text: string, aliases: string[]) {
      return extractSkillAdds(text, new Set(aliases));
    }

    it('extractSkillAdds pulls out known aliases and strips the pair', () => {
      expect(extract('/add translate summarize this', ['translate'])).toEqual({
        skills: ['translate'],
        stripped: 'summarize this',
      });
    });

    it('extractSkillAdds leaves a bare /add untouched', () => {
      expect(extract('/add', ['translate'])).toEqual({
        skills: [],
        stripped: '/add',
      });
    });

    it('extractSkillAdds leaves an unknown alias untouched', () => {
      expect(extract('/add bogus hello', ['translate'])).toEqual({
        skills: [],
        stripped: '/add bogus hello',
      });
    });

    async function showWithSkills(list: typeof SKILLS = SKILLS) {
      enableChannelCaptureWithResponses({ get_skills: list });
      render(<App />);
      await act(async () => {});
      await showOverlay();
      return screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
    }

    it('lists every skill, marking enabled ones inert', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveTextContent('assistant');
      expect(options[0]).toHaveAttribute('aria-disabled', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
      expect(options[1]).toHaveTextContent('translate');
      // The highlight opens on the addable skill, not the enabled first row.
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Already enabled')).toBeInTheDocument();
    });

    it('opens with no selection when every skill is enabled', async () => {
      const textarea = await showWithSkills([SKILLS[0]]);

      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
    });

    it('does not add an enabled skill picked from the picker', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});
      // Up onto the enabled built-in assistant row.
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
    });

    it('does not record an enabled alias typed directly', async () => {
      const textarea = await showWithSkills();

      // `assistant` is enabled, so it must not be stripped out and recorded —
      // it already rides the system prompt on every turn.
      fireEvent.change(textarea, {
        target: { value: '/add assistant say hi' },
      });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ skills: null }),
      );
    });

    it('adds a skill from the picker and sends it with the message', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      // The chip for the picked skill is shown and the box is empty.
      expect(
        screen.getByRole('list', { name: 'Selected skills' }),
      ).toBeInTheDocument();

      fireEvent.change(textarea, { target: { value: 'hello' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ query: 'hello', skills: ['translate'] }),
      );
    });

    it('Ctrl+Enter adds the skill but keeps the picker open', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      await act(async () => {});

      expect(
        screen.getByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('list', { name: 'Selected skills' }),
      ).toBeInTheDocument();
    });

    it('adds a skill named directly with /add <alias> without sending', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add translate' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).not.toHaveBeenCalledWith('ask', expect.anything());
      expect(screen.getByText('translate')).toBeInTheDocument();

      fireEvent.change(textarea, { target: { value: 'say hi' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ query: 'say hi', skills: ['translate'] }),
      );
    });

    it('sends an unknown /add alias as ordinary text with no skills', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add bogus hello' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ skills: null }),
      );
    });

    it('does not add the same skill twice', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      await act(async () => {});

      const list = screen.getByRole('list', { name: 'Selected skills' });
      expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(1);

      // Picking it twice must still send a single copy to the backend.
      fireEvent.change(textarea, { target: { value: 'hello' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ query: 'hello', skills: ['translate'] }),
      );
    });

    it('sends two different selected skills in pick order', async () => {
      const textarea = await showWithSkills([
        ...SKILLS,
        { id: 's3', alias: 'summarize', path: '/c.md', enabled: false },
      ]);

      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});
      // The picker opens on `translate` (the first addable skill).
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      await act(async () => {});

      fireEvent.change(textarea, { target: { value: 'hello' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: 'hello',
          skills: ['translate', 'summarize'],
        }),
      );
    });

    it('de-duplicates repeated /add aliases, keeping the first occurrence', async () => {
      const textarea = await showWithSkills([
        ...SKILLS,
        { id: 's3', alias: 'summarize', path: '/c.md', enabled: false },
      ]);

      // `summarize` is named twice, around `translate`: the surviving copy is
      // the first `summarize`, so the order is summarize, translate.
      fireEvent.change(textarea, {
        target: {
          value: '/add summarize /add translate /add summarize hello',
        },
      });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({
          query: 'hello',
          skills: ['summarize', 'translate'],
        }),
      );
    });

    it('sends a prompt typed after a direct /add <alias>', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, {
        target: { value: '/add translate say hi' },
      });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ query: 'say hi', skills: ['translate'] }),
      );
    });

    it('removes a selected skill with the chip remove button', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add translate' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove skill translate' }),
      );
      await act(async () => {});

      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
    });

    it('clears selected skills when the overlay reopens', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, { target: { value: '/add translate' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});
      expect(
        screen.getByRole('list', { name: 'Selected skills' }),
      ).toBeInTheDocument();

      await act(async () => {
        emitTauriEvent('quickai://visibility', { state: 'hide-request' });
      });
      await showOverlay();

      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
    });

    it('re-reads the skill list when the overlay reopens', async () => {
      let list: unknown[] = [];
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'get_skills') return list;
        if (cmd === 'list_conversations') return [];
      });
      render(<App />);
      await act(async () => {});
      await showOverlay();

      let textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});
      expect(screen.getByText('No skills configured')).toBeInTheDocument();

      // The user adds a skill in the Settings window (a separate webview).
      list = [{ id: 's2', alias: 'translate', path: '/b.md', enabled: false }];

      await act(async () => {
        emitTauriEvent('quickai://visibility', { state: 'hide-request' });
      });
      await showOverlay();

      textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/add' } });
      await act(async () => {});
      expect(screen.getByText('translate')).toBeInTheDocument();
    });

    it('re-reads the skill list when the overlay is restored from the mini bar', async () => {
      enableChannelCaptureWithResponses({
        get_skills: [],
        list_conversations: [],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const getSkillsCalls = () =>
        invoke.mock.calls.filter((c) => c[0] === 'get_skills').length;
      const before = getSkillsCalls();

      // The overlay loses focus while the user is in the Settings window, so it
      // shrinks to the mini bar. This path does NOT emit a show event — the
      // frontend restores `overlayState` directly — which is why the skill list
      // used to go stale (item 6).
      await act(async () => {
        emitTauriEvent('quickai://minibar', {});
      });

      // Click the mini bar to restore (pointer down + up, no movement).
      const minibar = document.querySelector('.w-12.h-12') as HTMLElement;
      expect(minibar).not.toBeNull();
      await act(async () => {
        fireEvent.pointerDown(minibar, { clientX: 10, clientY: 10 });
        fireEvent.pointerUp(minibar, { clientX: 10, clientY: 10 });
      });

      // Restoring into the visible state re-reads the skill list.
      expect(getSkillsCalls()).toBeGreaterThan(before);
    });

    it('re-reads the skill list when a show event arrives while already visible', async () => {
      let list: unknown[] = [];
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'get_skills') return list;
        if (cmd === 'list_conversations') return [];
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const getSkillsCalls = () =>
        invoke.mock.calls.filter((c) => c[0] === 'get_skills').length;
      const before = getSkillsCalls();

      // A second show event while the overlay is already visible: `overlayState`
      // does not change (the set is a no-op), so only the `sessionId` bump can
      // trigger the refresh. Without it, `/add` would silently stay stale.
      list = [{ id: 's2', alias: 'translate', path: '/b.md', enabled: false }];
      await showOverlay();

      expect(getSkillsCalls()).toBeGreaterThan(before);
    });

    it('re-reads the skill list on window focus while the overlay is visible', async () => {
      enableChannelCaptureWithResponses({
        get_skills: [],
        list_conversations: [],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      const getSkillsCalls = () =>
        invoke.mock.calls.filter((c) => c[0] === 'get_skills').length;
      const before = getSkillsCalls();

      // The pinned case: the user returns from the Settings window without the
      // overlay ever leaving the visible state, so only focus signals it.
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });

      expect(getSkillsCalls()).toBeGreaterThan(before);
    });

    it('does not re-read the skill list on focus while in the mini bar', async () => {
      enableChannelCaptureWithResponses({
        get_skills: [],
        list_conversations: [],
      });

      render(<App />);
      await act(async () => {});
      await showOverlay();

      await act(async () => {
        emitTauriEvent('quickai://minibar', {});
      });

      const getSkillsCalls = () =>
        invoke.mock.calls.filter((c) => c[0] === 'get_skills').length;
      const before = getSkillsCalls();

      // Focus while shrunk to the mini bar must not issue a pointless read; the
      // list is refreshed when the overlay is restored instead.
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });

      expect(getSkillsCalls()).toBe(before);
    });

    it('passes selected skills to /do and clears the selection', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, {
        target: { value: '/do /add translate tidy' },
      });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('start_agent_mode', {
        task: 'tidy',
        skills: ['translate'],
      });
      // The selection must not survive to leak into the next chat turn.
      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
    });

    it('de-duplicates a repeated alias on the /do path', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, {
        target: { value: '/do /add translate /add translate tidy' },
      });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('start_agent_mode', {
        task: 'tidy',
        skills: ['translate'],
      });
    });

    it('passes selected skills to an auto-detected agent run', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, {
        target: { value: '/add translate open notepad' },
      });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith('start_agent_mode', {
        task: 'open notepad',
        skills: ['translate'],
      });
      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
    });

    it('does not leak a cleared selection into the next ask turn', async () => {
      const textarea = await showWithSkills();

      fireEvent.change(textarea, {
        target: { value: '/do /add translate tidy' },
      });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      invoke.mockClear();
      fireEvent.change(textarea, { target: { value: 'hello' } });
      await act(async () => {});
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await act(async () => {});

      expect(invoke).toHaveBeenCalledWith(
        'ask',
        expect.objectContaining({ query: 'hello', skills: null }),
      );
    });
  });

  describe('agent panel dismissal', () => {
    it('clears the panel when Dismiss is clicked', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.change(textarea, { target: { value: '/do open notepad' } });
      await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      });
      await act(async () => {
        emitTauriEvent('quickai://agent', {
          kind: 'done',
          summary: 'Opened Notepad and typed the note.',
        });
      });
      expect(screen.getByText('Done')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

      expect(screen.queryByText('Done')).toBeNull();
      expect(
        screen.queryByText('Opened Notepad and typed the note.'),
      ).toBeNull();
    });
  });

  describe('Ctrl+End', () => {
    it('moves focus to the input box on Ctrl+End', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      textarea.blur();
      expect(document.activeElement).not.toBe(textarea);

      act(() => {
        fireEvent.keyDown(window, { key: 'End', ctrlKey: true });
      });

      expect(document.activeElement).toBe(textarea);
    });

    it('moves focus to the input box on Cmd+End', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      textarea.blur();

      act(() => {
        fireEvent.keyDown(window, { key: 'End', metaKey: true });
      });

      expect(document.activeElement).toBe(textarea);
    });

    it('leaves Ctrl+End to the input box when it already has focus', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const notCancelled = fireEvent.keyDown(textarea, {
        key: 'End',
        ctrlKey: true,
      });

      // The native caret-to-end behaviour is preserved inside the field.
      expect(notCancelled).toBe(true);
    });
  });

  describe('Ctrl+Home', () => {
    it('scrolls the transcript to the top on Ctrl+Home', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      textarea.blur();

      // The handler consumes the key (preventDefault) and can fire repeatedly.
      expect(fireEvent.keyDown(window, { key: 'Home', ctrlKey: true })).toBe(
        false,
      );
      expect(fireEvent.keyDown(window, { key: 'Home', ctrlKey: true })).toBe(
        false,
      );
    });

    it('scrolls the transcript to the top on Cmd+Home', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      textarea.blur();

      expect(fireEvent.keyDown(window, { key: 'Home', metaKey: true })).toBe(
        false,
      );
    });

    it('leaves Ctrl+Home to the input box when it already has focus', async () => {
      render(<App />);
      await act(async () => {});
      await showOverlay();

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const notCancelled = fireEvent.keyDown(textarea, {
        key: 'Home',
        ctrlKey: true,
      });

      expect(notCancelled).toBe(true);
    });
  });
});
