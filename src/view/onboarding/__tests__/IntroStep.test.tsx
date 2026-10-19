import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntroStep } from '../IntroStep';
import { invoke } from '../../../testUtils/mocks/tauri';

describe('IntroStep', () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockResolvedValue(undefined);
  });

  it('renders the title', () => {
    render(<IntroStep onComplete={vi.fn()} />);
    expect(screen.getByText('Before you dive in')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<IntroStep onComplete={vi.fn()} />);
    expect(
      screen.getByText("You'll get the hang of it quickly."),
    ).toBeInTheDocument();
  });

  it('renders all 5 facts', () => {
    render(<IntroStep onComplete={vi.fn()} />);
    expect(screen.getByText('Double-tap')).toBeInTheDocument();
    expect(screen.getByText('to summon')).toBeInTheDocument();
    expect(
      screen.getByText('Select text, then double-tap'),
    ).toBeInTheDocument();
    expect(screen.getByText('Drop in any image')).toBeInTheDocument();
    expect(screen.getByText('for context')).toBeInTheDocument();
    expect(screen.getByText('Floats above everything')).toBeInTheDocument();
  });

  it('renders the Ctrl key chips', () => {
    render(<IntroStep onComplete={vi.fn()} />);
    expect(screen.getAllByText('Ctrl').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Get Started button', () => {
    render(<IntroStep onComplete={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /get started/i }),
    ).toBeInTheDocument();
  });

  it('renders the footer note', () => {
    render(<IntroStep onComplete={vi.fn()} />);
    expect(
      screen.getByText(/api keys stay on this machine/i),
    ).toBeInTheDocument();
  });

  it('calls finish_onboarding and onComplete when Get Started is clicked', async () => {
    const onComplete = vi.fn();
    render(<IntroStep onComplete={onComplete} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    });

    expect(invoke).toHaveBeenCalledWith('finish_onboarding');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('paints the panel from theme tokens, not fixed colours (item 19)', () => {
    const { container } = render(<IntroStep onComplete={vi.fn()} />);
    // The panel is the first element carrying the radial-gradient backdrop.
    const panel = container.querySelector(
      'div[style*="radial-gradient"]',
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    // Read the raw attribute: jsdom's CSS parser drops gradients from
    // `style.background`, so asserting on the serialized style is reliable.
    const style = panel.getAttribute('style')!;
    expect(style).toContain('var(--color-primary)');
    expect(style).toContain('var(--color-surface-elevated)');
    expect(style).toContain('var(--color-surface-border)');
    expect(style).not.toMatch(/#[0-9a-f]{6}/i);
    expect(style).not.toContain('rgba(');
  });
});
