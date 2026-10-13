import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandSuggestion } from '../CommandSuggestion';
import type { Command } from '../../config/commands';
import { en } from '../../i18n/en';

const SCREEN_CMD: Command = {
  trigger: '/screen',
  label: '/screen',
  descriptionKey: 'command.screen.desc',
};

const DO_CMD: Command = {
  trigger: '/do',
  label: '/do',
  descriptionKey: 'command.do.desc',
};

const THINK_CMD: Command = {
  trigger: '/think',
  label: '/think',
  descriptionKey: 'command.think.desc',
};

const TRANSLATE_CMD: Command = {
  trigger: '/translate',
  label: '/translate',
  descriptionKey: 'command.translate.desc',
};

const REWRITE_CMD: Command = {
  trigger: '/rewrite',
  label: '/rewrite',
  descriptionKey: 'command.rewrite.desc',
};

const TLDR_CMD: Command = {
  trigger: '/tldr',
  label: '/tldr',
  descriptionKey: 'command.tldr.desc',
};

const REFINE_CMD: Command = {
  trigger: '/refine',
  label: '/refine',
  descriptionKey: 'command.refine.desc',
};

const BULLETS_CMD: Command = {
  trigger: '/bullets',
  label: '/bullets',
  descriptionKey: 'command.bullets.desc',
};

const ACTION_CMD: Command = {
  trigger: '/todos',
  label: '/todos',
  descriptionKey: 'command.todos.desc',
  promptTemplate: 'dummy $INPUT',
};

describe('CommandSuggestion', () => {
  it('shows "No commands found" when commands list is empty', () => {
    render(
      <CommandSuggestion
        commands={[]}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('No commands found')).toBeInTheDocument();
  });

  it('renders each command trigger and its localized description', () => {
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD, DO_CMD]}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('/screen')).toBeInTheDocument();
    expect(screen.getByText(en['command.screen.desc'])).toBeInTheDocument();
    expect(screen.getByText('/do')).toBeInTheDocument();
    expect(screen.getByText(en['command.do.desc'])).toBeInTheDocument();
  });

  it('shows the Commands header', () => {
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD]}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Commands')).toBeInTheDocument();
  });

  it('marks the highlighted row as aria-selected', () => {
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD, DO_CMD]}
        highlightedIndex={1}
        onSelect={vi.fn()}
      />,
    );
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the Tab badge only on the highlighted row', () => {
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD, DO_CMD]}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Tab')).toHaveLength(1);
  });

  it('shows no Tab badge when nothing is highlighted (index -1)', () => {
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD]}
        highlightedIndex={-1}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText('Tab')).toBeNull();
  });

  it('calls onSelect with the trigger when a row is clicked (mousedown)', () => {
    const onSelect = vi.fn();
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD]}
        highlightedIndex={0}
        onSelect={onSelect}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledWith('/screen');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect with the correct trigger when the second row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD, DO_CMD]}
        highlightedIndex={0}
        onSelect={onSelect}
      />,
    );
    fireEvent.mouseDown(screen.getAllByRole('option')[1]);
    expect(onSelect).toHaveBeenCalledWith('/do');
  });

  it('renders the listbox with an accessible label', () => {
    render(
      <CommandSuggestion
        commands={[SCREEN_CMD]}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('listbox', { name: 'Command suggestions' }),
    ).toBeInTheDocument();
  });

  it('does not throw when highlightedIndex is out of range', () => {
    expect(() => {
      render(
        <CommandSuggestion
          commands={[SCREEN_CMD]}
          highlightedIndex={99}
          onSelect={vi.fn()}
        />,
      );
    }).not.toThrow();
  });

  it('renders an SVG icon for each command row', () => {
    const allCmds = [
      SCREEN_CMD,
      THINK_CMD,
      TRANSLATE_CMD,
      REWRITE_CMD,
      TLDR_CMD,
      REFINE_CMD,
      BULLETS_CMD,
      ACTION_CMD,
    ];
    const { container } = render(
      <CommandSuggestion
        commands={allCmds}
        highlightedIndex={-1}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('svg').length).toBe(allCmds.length);
  });

  it('renders utility command labels', () => {
    render(
      <CommandSuggestion
        commands={[
          TRANSLATE_CMD,
          REWRITE_CMD,
          TLDR_CMD,
          REFINE_CMD,
          BULLETS_CMD,
          ACTION_CMD,
        ]}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('/translate')).toBeInTheDocument();
    expect(screen.getByText('/rewrite')).toBeInTheDocument();
    expect(screen.getByText('/tldr')).toBeInTheDocument();
    expect(screen.getByText('/refine')).toBeInTheDocument();
    expect(screen.getByText('/bullets')).toBeInTheDocument();
    expect(screen.getByText('/todos')).toBeInTheDocument();
  });
});
