import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TipBar } from '../TipBar';
import { invoke } from '../../testUtils/mocks/tauri';
import { en } from '../../i18n/en';

describe('TipBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('types out the tip text and shows the TIP badge', () => {
    render(<TipBar tip={{ textKey: 'tip.screen' }} tipKey={0} />);

    expect(screen.getByText('TIP')).toBeInTheDocument();

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByTestId('tip-text').textContent).toBe(en['tip.screen']);
  });

  it('retypes the next tip after a fade when tipKey changes', () => {
    const { rerender } = render(
      <TipBar tip={{ textKey: 'tip.screen' }} tipKey={0} />,
    );
    act(() => {
      vi.runAllTimers();
    });

    rerender(<TipBar tip={{ textKey: 'tip.hide' }} tipKey={1} />);
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByTestId('tip-text').textContent).toBe(en['tip.hide']);
  });

  it('renders a clickable bar that opens the tip URL', () => {
    render(
      <TipBar
        tip={{ textKey: 'tip.screen', url: 'https://example.com/guide' }}
        tipKey={0}
      />,
    );

    const button = screen.getByRole('button', { name: /open tip link/i });
    fireEvent.click(button);

    expect(invoke).toHaveBeenCalledWith('open_url', {
      url: 'https://example.com/guide',
    });
  });
});
