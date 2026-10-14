import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationItem } from '../ConversationItem';
import type { ConversationSummary } from '../../types/history';

const SUMMARY: ConversationSummary = {
  id: 'conv-1',
  title: 'How does React work?',
  model: 'gemini-3-flash-preview',
  updated_at: Date.now(),
  message_count: 6,
};

function renderItem(
  overrides: Partial<Parameters<typeof ConversationItem>[0]> = {},
) {
  return render(
    <ConversationItem
      conversation={SUMMARY}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onRename={vi.fn()}
      {...overrides}
    />,
  );
}

/** Right-click the row to open the context menu. */
function openMenu() {
  fireEvent.contextMenu(screen.getByText('How does React work?'));
}

describe('ConversationItem', () => {
  it('renders the conversation title', () => {
    renderItem();
    expect(screen.getByText('How does React work?')).toBeInTheDocument();
  });

  it('renders "Untitled" when title is null', () => {
    renderItem({ conversation: { ...SUMMARY, title: null } });
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('renders relative timestamp', () => {
    renderItem();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('calls onSelect with conversation id when clicked', () => {
    const onSelect = vi.fn();
    renderItem({ onSelect });
    fireEvent.click(
      screen.getByRole('button', { name: /how does react work/i }),
    );
    expect(onSelect).toHaveBeenCalledWith('conv-1');
  });

  it('calls onDelete with conversation id when delete button is clicked', () => {
    const onDelete = vi.fn();
    renderItem({ onDelete });
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('conv-1');
  });

  it('does not call onSelect when delete button is clicked', () => {
    const onSelect = vi.fn();
    renderItem({ onSelect });
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies active styling when isActive is true', () => {
    renderItem({ isActive: true });
    const button = screen.getByRole('button', {
      name: /how does react work/i,
    });
    expect(button).toHaveAttribute('aria-current', 'true');
    expect(button.className).toContain('bg-primary/10');
    expect(button.className).toContain('border-primary');
  });

  it('does not apply active styling when isActive is false', () => {
    renderItem({ isActive: false });
    const button = screen.getByRole('button', {
      name: /how does react work/i,
    });
    expect(button).not.toHaveAttribute('aria-current');
    expect(button.className).not.toContain('bg-primary/10');
  });

  describe('context menu', () => {
    it('opens on right-click and closes on backdrop click', () => {
      const { container } = renderItem();
      expect(screen.queryByText('Rename')).toBeNull();

      openMenu();
      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();

      const backdrop = container.querySelector('.fixed.inset-0')!;
      fireEvent.click(backdrop);
      expect(screen.queryByText('Rename')).toBeNull();
    });

    it('closes when the backdrop is right-clicked', () => {
      const { container } = renderItem();
      openMenu();
      const backdrop = container.querySelector('.fixed.inset-0')!;
      fireEvent.contextMenu(backdrop);
      expect(screen.queryByText('Rename')).toBeNull();
    });
  });

  describe('rename', () => {
    it('commits the new name on Enter', () => {
      const onRename = vi.fn();
      renderItem({ onRename });
      openMenu();
      fireEvent.click(screen.getByText('Rename'));

      const input = screen.getByRole('textbox', { name: 'Rename' });
      expect(input).toHaveValue('How does React work?');

      fireEvent.change(input, { target: { value: 'React deep dive' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onRename).toHaveBeenCalledWith('conv-1', 'React deep dive');
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('commits on blur', () => {
      const onRename = vi.fn();
      renderItem({ onRename });
      openMenu();
      fireEvent.click(screen.getByText('Rename'));

      const input = screen.getByRole('textbox', { name: 'Rename' });
      fireEvent.change(input, { target: { value: 'Blurred' } });
      fireEvent.blur(input);

      expect(onRename).toHaveBeenCalledWith('conv-1', 'Blurred');
    });

    it('ignores an empty draft', () => {
      const onRename = vi.fn();
      renderItem({ onRename });
      openMenu();
      fireEvent.click(screen.getByText('Rename'));

      const input = screen.getByRole('textbox', { name: 'Rename' });
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onRename).not.toHaveBeenCalled();
    });

    it('ignores an unchanged draft', () => {
      const onRename = vi.fn();
      renderItem({ onRename });
      openMenu();
      fireEvent.click(screen.getByText('Rename'));

      const input = screen.getByRole('textbox', { name: 'Rename' });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onRename).not.toHaveBeenCalled();
    });

    it('seeds an empty draft when the conversation has no title', () => {
      renderItem({ conversation: { ...SUMMARY, title: null } });
      fireEvent.contextMenu(screen.getByText('Untitled'));
      fireEvent.click(screen.getByText('Rename'));
      expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveValue('');
    });

    it('cancels on Escape without renaming', () => {
      const onRename = vi.fn();
      renderItem({ onRename });
      openMenu();
      fireEvent.click(screen.getByText('Rename'));

      const input = screen.getByRole('textbox', { name: 'Rename' });
      fireEvent.change(input, { target: { value: 'Discarded' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText('How does React work?')).toBeInTheDocument();
    });

    it('ignores unrelated keys in the rename field', () => {
      renderItem();
      openMenu();
      fireEvent.click(screen.getByText('Rename'));
      const input = screen.getByRole('textbox', { name: 'Rename' });
      fireEvent.keyDown(input, { key: 'a' });
      expect(
        screen.getByRole('textbox', { name: 'Rename' }),
      ).toBeInTheDocument();
    });
  });

  describe('delete confirmation', () => {
    it('asks for confirmation then deletes', () => {
      const onDelete = vi.fn();
      renderItem({ onDelete });
      openMenu();
      fireEvent.click(screen.getByText('Delete'));

      expect(screen.getByText('Delete conversation?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(onDelete).toHaveBeenCalledWith('conv-1');
    });

    it('cancels the confirmation without deleting', () => {
      const onDelete = vi.fn();
      renderItem({ onDelete });
      openMenu();
      fireEvent.click(screen.getByText('Delete'));

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.getByText('How does React work?')).toBeInTheDocument();
    });
  });
});
