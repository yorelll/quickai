import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SkillChips } from '../SkillChips';

describe('SkillChips', () => {
  it('renders nothing when no skills are selected', () => {
    const { container } = render(<SkillChips skills={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip per selected skill', () => {
    render(
      <SkillChips skills={['translate', 'assistant']} onRemove={vi.fn()} />,
    );
    expect(
      screen.getByRole('list', { name: 'Selected skills' }),
    ).toBeInTheDocument();
    expect(screen.getByText('translate')).toBeInTheDocument();
    expect(screen.getByText('assistant')).toBeInTheDocument();
  });

  it('calls onRemove with the alias when the remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<SkillChips skills={['translate']} onRemove={onRemove} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove skill translate' }),
    );
    expect(onRemove).toHaveBeenCalledWith('translate');
  });
});
