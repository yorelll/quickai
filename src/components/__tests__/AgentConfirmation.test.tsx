import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentConfirmation } from '../AgentConfirmation';

const noop = () => {};

function renderConfirmation(
  overrides: Partial<React.ComponentProps<typeof AgentConfirmation>> = {},
) {
  return render(
    <AgentConfirmation
      action={{ type: 'launch', app: 'notepad' }}
      onConfirm={noop}
      onReject={noop}
      {...overrides}
    />,
  );
}

describe('AgentConfirmation', () => {
  it('renders the prompt, the localized action and both choices', () => {
    renderConfirmation();
    expect(screen.getByText('Action requires confirmation:')).toBeDefined();
    expect(screen.getByText('Open notepad')).toBeDefined();
    expect(screen.getByText('Allow')).toBeDefined();
    expect(screen.getByText('Deny')).toBeDefined();
  });

  it('selects 允许 (Allow) by default', () => {
    renderConfirmation();
    const allow = screen.getByRole('button', { name: 'Allow' });
    const deny = screen.getByRole('button', { name: 'Deny' });
    expect(allow.getAttribute('aria-pressed')).toBe('true');
    expect(deny.getAttribute('aria-pressed')).toBe('false');
    expect(allow.className).toContain('ring-tertiary');
    expect(deny.className).not.toContain('ring-status-error');
  });

  it('moves the selection with the arrow keys', () => {
    renderConfirmation();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(
      screen.getByRole('button', { name: 'Deny' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Deny' }).className).toContain(
      'ring-status-error',
    );
    expect(
      screen.getByRole('button', { name: 'Allow' }).className,
    ).not.toContain('ring-tertiary');

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(
      screen
        .getByRole('button', { name: 'Allow' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('activates the selected choice on Enter', () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    renderConfirmation({ onConfirm, onReject });

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('leaves the selection alone for other keys', () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    renderConfirmation({ onConfirm, onReject });

    fireEvent.keyDown(document, { key: 'a' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: 'Allow' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('confirms and rejects on click', () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    renderConfirmation({ onConfirm, onReject });

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('detaches its key listener on unmount', () => {
    const onConfirm = vi.fn();
    const { unmount } = renderConfirmation({ onConfirm });

    unmount();
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('still receives keys when the focused input swallows them', () => {
    // Pins the capture-phase listener. The overlay's textarea holds focus while
    // the bar is open and stopped these keys bubbling in batch 2 — a bubble-phase
    // document listener would never fire here, so this test would fail if the
    // listener were ever moved to the bubble phase.
    const onConfirm = vi.fn();
    render(
      <>
        <input aria-label="chat" />
        <AgentConfirmation
          action={{ type: 'launch', app: 'notepad' }}
          onConfirm={onConfirm}
          onReject={noop}
        />
      </>,
    );

    const input = screen.getByRole('textbox', { name: 'chat' });
    input.addEventListener('keydown', (event) => event.stopPropagation());
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
