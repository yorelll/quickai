import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WindowControls } from '../WindowControls';

describe('WindowControls', () => {
  it('close button calls onClose when clicked', () => {
    const onClose = vi.fn();
    render(<WindowControls onClose={onClose} onMinimize={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close button has Windows close styling', () => {
    render(<WindowControls onClose={vi.fn()} onMinimize={vi.fn()} />);
    const closeBtn = screen.getByRole('button', { name: 'Close window' });
    expect(closeBtn).toHaveClass('win-title-btn-close');
  });

  it('renders minimize button', () => {
    render(<WindowControls onClose={vi.fn()} onMinimize={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Minimize' }),
    ).toBeInTheDocument();
  });

  it('minimize button calls onMinimize when clicked', () => {
    const onMinimize = vi.fn();
    render(<WindowControls onClose={vi.fn()} onMinimize={onMinimize} />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it('renders divider separator (bg-surface-border)', () => {
    const { container } = render(
      <WindowControls onClose={vi.fn()} onMinimize={vi.fn()} />,
    );
    expect(container.querySelector('.bg-surface-border')).not.toBeNull();
  });

  it('close button has x icon svg', () => {
    render(<WindowControls onClose={vi.fn()} onMinimize={vi.fn()} />);
    const closeBtn = screen.getByRole('button', { name: 'Close window' });
    const svg = closeBtn.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('save button shows "Save conversation" aria-label when not saved', () => {
    render(
      <WindowControls
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onSave={vi.fn()}
        canSave
        isSaved={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Save conversation' }),
    ).toBeInTheDocument();
  });

  it('save button shows "Remove from history" aria-label when saved', () => {
    render(
      <WindowControls
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onSave={vi.fn()}
        canSave
        isSaved
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Remove from history' }),
    ).toBeInTheDocument();
  });

  it('save button calls onSave when clicked while saved', () => {
    const onSave = vi.fn();
    render(
      <WindowControls
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onSave={onSave}
        canSave
        isSaved
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove from history' }),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('renders the conversation title and forwards renames', () => {
    const onRenameTitle = vi.fn();
    render(
      <WindowControls
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        title="Weekly plan"
        onRenameTitle={onRenameTitle}
      />,
    );
    expect(screen.getByText('Weekly plan')).toBeInTheDocument();

    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    const input = screen.getByRole('textbox', { name: 'Conversation name' });
    fireEvent.change(input, { target: { value: 'Sprint plan' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTitle).toHaveBeenCalledWith('Sprint plan');
  });

  it('omits the title when none is provided', () => {
    render(<WindowControls onClose={vi.fn()} onMinimize={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Rename conversation' }),
    ).toBeNull();
  });

  it('renders a pin button that reflects and toggles the pinned state', () => {
    const onTogglePin = vi.fn();
    const { rerender } = render(
      <WindowControls
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        isPinned={false}
        onTogglePin={onTogglePin}
      />,
    );

    const pin = screen.getByRole('button', { name: 'Pin window' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pin);
    expect(onTogglePin).toHaveBeenCalledTimes(1);

    rerender(
      <WindowControls
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        isPinned
        onTogglePin={onTogglePin}
      />,
    );
    const unpin = screen.getByRole('button', { name: 'Unpin window' });
    expect(unpin).toHaveAttribute('aria-pressed', 'true');
  });

  it('omits the pin button when no toggle is provided', () => {
    render(<WindowControls onClose={vi.fn()} onMinimize={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Pin window' })).toBeNull();
  });
});
