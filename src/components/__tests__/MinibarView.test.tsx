import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MinibarView } from '../MinibarView';
import { __mockWindow } from '../../testUtils/mocks/tauri-window';
import type { AgentStatus } from '../../hooks/useAgentMode';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => React.createElement('div', props, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

/**
 * Dispatches a `pointermove` on `window` with real coordinates. jsdom's
 * PointerEvent support is partial, so a MouseEvent carrying the pointer type
 * is the most reliable way to drive the window-level listeners.
 */
function pointerMove(clientX: number, clientY: number) {
  window.dispatchEvent(
    new MouseEvent('pointermove', { bubbles: true, clientX, clientY }),
  );
}

function pointerUp(clientX: number, clientY: number) {
  window.dispatchEvent(
    new MouseEvent('pointerup', { bubbles: true, clientX, clientY }),
  );
}

describe('MinibarView', () => {
  it('should render the logo icon', () => {
    render(<MinibarView status={null} onClick={() => {}} />);
    const img = screen.getByAltText('QuickAI');
    expect(img).toBeDefined();
  });

  it('should call onClick on pointer down + up without movement', () => {
    const onClick = vi.fn();
    const { container } = render(
      <MinibarView status={null} onClick={onClick} />,
    );
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(el, { clientX: 10, clientY: 10 });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('should NOT call onClick when pointer moves beyond threshold', () => {
    const onClick = vi.fn();
    const { container } = render(
      <MinibarView status={null} onClick={onClick} />,
    );
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    // Simulate a move beyond the 3px threshold
    fireEvent.pointerMove(el, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(el, { clientX: 20, clientY: 10 });
    expect(onClick).not.toHaveBeenCalled();
  });

  /** Class list of the status dot (the absolutely positioned badge). */
  function dotClass(): string {
    return document.querySelector('span.absolute')?.className ?? '';
  }

  it('should render with idle status dot', () => {
    render(<MinibarView status="idle" onClick={() => {}} />);
    expect(dotClass()).toContain('bg-[light-dark(#1a7f37,#4ade80)]');
  });

  it('should render with executing status dot', () => {
    render(<MinibarView status="executing" onClick={() => {}} />);
    expect(dotClass()).toContain('bg-tertiary');
  });

  it('should render with error status dot', () => {
    render(<MinibarView status="error" onClick={() => {}} />);
    expect(dotClass()).toContain('bg-[light-dark(#b3261e,#ff8a80)]');
  });

  it('should pulse during active agent status', () => {
    render(<MinibarView status="analyzing" onClick={() => {}} />);
    const dot = document.querySelector('.animate-pulse');
    expect(dot).not.toBeNull();
  });

  it('falls back to a neutral dot for an unknown status', () => {
    render(
      <MinibarView status={'mystery' as AgentStatus} onClick={() => {}} />,
    );
    expect(dotClass()).toContain('bg-text-secondary');
  });

  it('starts a native drag when the pointer moves past the threshold', () => {
    const onClick = vi.fn();
    const { container } = render(
      <MinibarView status={null} onClick={onClick} />,
    );
    const el = container.firstChild as HTMLElement;
    __mockWindow.startDragging.mockClear();

    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    pointerMove(20, 10);
    pointerUp(20, 10);

    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('starts a native drag on a vertical-only move', () => {
    const onClick = vi.fn();
    const { container } = render(
      <MinibarView status={null} onClick={onClick} />,
    );
    const el = container.firstChild as HTMLElement;
    __mockWindow.startDragging.mockClear();

    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    pointerMove(10, 20);

    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores a move that stays inside the threshold', () => {
    const onClick = vi.fn();
    const { container } = render(
      <MinibarView status={null} onClick={onClick} />,
    );
    const el = container.firstChild as HTMLElement;
    __mockWindow.startDragging.mockClear();

    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    pointerMove(12, 11);
    pointerUp(12, 11);

    expect(__mockWindow.startDragging).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
