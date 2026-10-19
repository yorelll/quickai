import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AgentIndicator } from '../AgentIndicator';

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

const noop = () => {};

function renderIndicator(
  overrides: Partial<React.ComponentProps<typeof AgentIndicator>> = {},
) {
  return render(
    <AgentIndicator
      isActive={true}
      status="idle"
      lastAction={null}
      lastResult={null}
      reasoning={null}
      summary={null}
      notice={null}
      pendingConfirmation={null}
      onStop={noop}
      onConfirm={noop}
      onReject={noop}
      onDismiss={noop}
      {...overrides}
    />,
  );
}

describe('AgentIndicator', () => {
  it('renders nothing while idle and inactive', () => {
    renderIndicator({ isActive: false });
    expect(screen.queryByText('Agent')).toBeNull();
  });

  it.each([
    ['capturing', 'Capturing screen...'],
    ['analyzing', 'Analyzing...'],
    ['executing', 'Executing action...'],
    ['idle', 'Agent'],
  ] as const)('renders the %s status label while active', (status, label) => {
    renderIndicator({ status });
    expect(screen.getByText(label)).toBeDefined();
  });

  it('stays mounted for the terminal done state so the summary survives', () => {
    renderIndicator({
      isActive: false,
      status: 'done',
      summary: 'Opened Notepad and typed the note.',
    });

    expect(screen.getByText('Done')).toBeDefined();
    expect(
      screen.getByText('Opened Notepad and typed the note.'),
    ).toBeDefined();
  });

  it('stays mounted for the terminal error state and surfaces the message', () => {
    renderIndicator({
      isActive: false,
      status: 'error',
      lastResult: 'Provider is unavailable',
    });

    expect(screen.getByText('Error')).toBeDefined();
    expect(screen.getByText('Provider is unavailable')).toBeDefined();
  });

  it('does not treat an action result as an error message', () => {
    renderIndicator({
      status: 'executing',
      lastResult: 'clicked',
    });
    expect(screen.queryByText('clicked')).toBeNull();
  });

  it('renders no message block for an error without detail', () => {
    renderIndicator({ isActive: false, status: 'error', lastResult: null });
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('shows a non-fatal notice alongside the running state', () => {
    const { container } = renderIndicator({
      isActive: true,
      status: 'executing',
      notice: { code: 'skill_unreadable', message: 'translate: missing' },
    });

    // The panel stays in its running state — the notice must not flip it.
    expect(screen.getByText('Executing action...')).toBeDefined();
    expect(container.querySelector('[data-error-bar]')).not.toBeNull();
    expect(screen.getByText('translate: missing')).toBeDefined();
  });

  it('renders no notice block when there is none', () => {
    const { container } = renderIndicator({ isActive: true, status: 'idle' });
    expect(container.querySelector('[data-error-bar]')).toBeNull();
  });

  it('renders the localized last action', () => {
    renderIndicator({
      status: 'executing',
      lastAction: { type: 'click', x: 100, y: 200 },
    });
    expect(screen.getByText('Click (100, 200)')).toBeDefined();
  });

  it('renders model reasoning while analyzing', () => {
    renderIndicator({
      status: 'analyzing',
      reasoning: 'Looking for the Start button',
    });
    expect(screen.getByText('Looking for the Start button')).toBeDefined();
  });

  it('hides reasoning outside the analyzing phase', () => {
    renderIndicator({
      status: 'executing',
      reasoning: 'Looking for the Start button',
    });
    expect(screen.queryByText('Looking for the Start button')).toBeNull();
  });

  it('offers Stop only while the agent is active', () => {
    const onStop = vi.fn();
    const { rerender } = renderIndicator({ status: 'executing', onStop });
    fireEvent.click(screen.getByText('Stop'));
    expect(onStop).toHaveBeenCalledOnce();

    rerender(
      <AgentIndicator
        isActive={false}
        status="done"
        lastAction={null}
        lastResult={null}
        reasoning={null}
        summary="All done."
        notice={null}
        pendingConfirmation={null}
        onStop={onStop}
        onConfirm={noop}
        onReject={noop}
        onDismiss={noop}
      />,
    );
    expect(screen.queryByText('Stop')).toBeNull();
  });

  it('calls onDismiss from the close control', () => {
    const onDismiss = vi.fn();
    renderIndicator({
      isActive: false,
      status: 'done',
      summary: 'All done.',
      onDismiss,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('hides the dismiss control while the agent is still running', () => {
    renderIndicator({ status: 'executing' });
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByText('Stop')).toBeDefined();
  });

  it('renders the summary as markdown inside a scrollable block', () => {
    const { container } = renderIndicator({
      isActive: false,
      status: 'done',
      summary: '**Bold** summary',
    });
    expect(
      container.querySelector('[data-streamdown="strong"]'),
    ).not.toBeNull();
    expect(container.querySelector('.overflow-y-auto')).not.toBeNull();
  });

  it('shows the keyboard hint while a confirmation is pending', () => {
    renderIndicator({
      status: 'waiting_confirmation',
      pendingConfirmation: { type: 'click', x: 1, y: 2 },
    });
    expect(
      screen.getByText(
        '←/→ to select, Enter to confirm, 1 allow, 2 deny, Ctrl+C to abort',
      ),
    ).toBeDefined();
  });

  it('renders the confirmation prompt with the localized action', () => {
    renderIndicator({
      status: 'waiting_confirmation',
      pendingConfirmation: { type: 'launch', app: 'notepad' },
    });

    expect(screen.getByText('Confirm action...')).toBeDefined();
    expect(screen.getByText('Action requires confirmation:')).toBeDefined();
    expect(screen.getByText('Open notepad')).toBeDefined();
    expect(screen.getByText('Allow')).toBeDefined();
    expect(screen.getByText('Deny')).toBeDefined();
  });

  it('calls onConfirm and onReject without an id', () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    renderIndicator({
      status: 'waiting_confirmation',
      pendingConfirmation: { type: 'click', x: 1, y: 2 },
      onConfirm,
      onReject,
    });

    fireEvent.click(screen.getByText('Allow'));
    fireEvent.click(screen.getByText('Deny'));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });
});
