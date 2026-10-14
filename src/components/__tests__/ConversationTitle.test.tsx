import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationTitle } from '../ConversationTitle';

describe('ConversationTitle', () => {
  it('renders the conversation name', () => {
    render(<ConversationTitle title="Weekly plan" onRename={vi.fn()} />);
    expect(screen.getByText('Weekly plan')).toBeInTheDocument();
  });

  it('opens an inline editor on right-click', () => {
    render(<ConversationTitle title="Weekly plan" onRename={vi.fn()} />);
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    expect(
      screen.getByRole('textbox', { name: 'Conversation name' }),
    ).toHaveValue('Weekly plan');
  });

  it('commits the new name on Enter', () => {
    const onRename = vi.fn();
    render(<ConversationTitle title="Weekly plan" onRename={onRename} />);
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    const input = screen.getByRole('textbox', { name: 'Conversation name' });
    fireEvent.change(input, { target: { value: 'Sprint plan' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('Sprint plan');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('commits on blur', () => {
    const onRename = vi.fn();
    render(<ConversationTitle title="Weekly plan" onRename={onRename} />);
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    const input = screen.getByRole('textbox', { name: 'Conversation name' });
    fireEvent.change(input, { target: { value: 'Blurred name' } });
    fireEvent.blur(input);

    expect(onRename).toHaveBeenCalledWith('Blurred name');
  });

  it('ignores an empty draft', () => {
    const onRename = vi.fn();
    render(<ConversationTitle title="Weekly plan" onRename={onRename} />);
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    const input = screen.getByRole('textbox', { name: 'Conversation name' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).not.toHaveBeenCalled();
  });

  it('ignores an unchanged draft', () => {
    const onRename = vi.fn();
    render(<ConversationTitle title="Weekly plan" onRename={onRename} />);
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Conversation name' }),
      { key: 'Enter' },
    );

    expect(onRename).not.toHaveBeenCalled();
  });

  it('abandons the edit on Escape', () => {
    const onRename = vi.fn();
    render(<ConversationTitle title="Weekly plan" onRename={onRename} />);
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    const input = screen.getByRole('textbox', { name: 'Conversation name' });
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Weekly plan')).toBeInTheDocument();
  });

  it('ignores unrelated keys in the editor', () => {
    render(<ConversationTitle title="Weekly plan" onRename={vi.fn()} />);
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename conversation' }),
    );
    const input = screen.getByRole('textbox', { name: 'Conversation name' });
    fireEvent.keyDown(input, { key: 'a' });
    expect(
      screen.getByRole('textbox', { name: 'Conversation name' }),
    ).toBeInTheDocument();
  });
});
