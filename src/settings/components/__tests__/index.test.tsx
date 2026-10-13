import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Section,
  SettingRow,
  TextField,
  Textarea,
  NumberSlider,
  NumberStepper,
  Dropdown,
  SavedPill,
  ConfirmDialog,
} from '../index';

describe('Section', () => {
  it('renders its heading and children', () => {
    render(
      <Section heading="Window">
        <span>body</span>
      </Section>,
    );
    expect(screen.getByText('Window')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});

describe('SettingRow', () => {
  it('renders a label and its control', () => {
    render(
      <SettingRow label="Overlay width">
        <span>control</span>
      </SettingRow>,
    );
    expect(screen.getByText('Overlay width')).toBeInTheDocument();
    expect(screen.getByText('control')).toBeInTheDocument();
  });

  it('shows and hides the helper tooltip on hover and focus', () => {
    render(
      <SettingRow label="Overlay width" helper="How wide it is">
        <span>control</span>
      </SettingRow>,
    );
    const info = screen.getByRole('button', { name: 'About Overlay width' });

    fireEvent.mouseEnter(info);
    expect(screen.getByRole('tooltip')).toHaveTextContent('How wide it is');

    fireEvent.mouseLeave(info);
    fireEvent.focus(info);
    expect(screen.getByRole('tooltip')).toHaveTextContent('How wide it is');

    fireEvent.blur(info);
    expect(screen.getByRole('tooltip').className).not.toContain('Visible');
  });

  it('renders a localized config error', () => {
    render(
      <SettingRow
        label="Model"
        error={{ kind: 'parse', path: 'p', message: '' }}
      >
        <span>control</span>
      </SettingRow>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'config.toml has a syntax error. Restart QuickAI to recover.',
    );
  });
});

describe('TextField', () => {
  it('reports changes and flags errors', () => {
    const onChange = vi.fn();
    render(
      <TextField
        value="gpt-4o"
        onChange={onChange}
        placeholder="e.g. gpt-4o"
        ariaLabel="Chat model"
        list="models"
        errored
      />,
    );
    const input = screen.getByLabelText('Chat model');
    expect(input).toHaveAttribute('placeholder', 'e.g. gpt-4o');
    expect(input).toHaveAttribute('list', 'models');
    expect(input.className).toContain('inputError');

    fireEvent.change(input, { target: { value: 'o4-mini' } });
    expect(onChange).toHaveBeenCalledWith('o4-mini');
  });
});

describe('Textarea', () => {
  it('reports changes and caps the length', () => {
    const onChange = vi.fn();
    render(
      <Textarea
        value="hello"
        onChange={onChange}
        placeholder="Persona"
        maxLength={10}
        ariaLabel="System prompt"
      />,
    );
    const area = screen.getByLabelText('System prompt');
    expect(area).toHaveAttribute('maxlength', '10');

    fireEvent.change(area, { target: { value: 'hi' } });
    expect(onChange).toHaveBeenCalledWith('hi');
  });
});

describe('NumberSlider', () => {
  it('commits the dragged value on mouse up', () => {
    const onChange = vi.fn();
    render(
      <NumberSlider
        value={10}
        min={0}
        max={100}
        unit="px"
        onChange={onChange}
        ariaLabel="Overlay width"
      />,
    );
    const slider = screen.getByLabelText('Overlay width');

    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.mouseUp(slider);

    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('does not commit when the value did not change', () => {
    const onChange = vi.fn();
    render(
      <NumberSlider
        value={10}
        min={0}
        max={100}
        onChange={onChange}
        ariaLabel="Overlay width"
      />,
    );
    fireEvent.mouseUp(screen.getByLabelText('Overlay width'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not commit touch, blur or key-up without a change', () => {
    const onChange = vi.fn();
    render(
      <NumberSlider
        value={10}
        min={0}
        max={100}
        onChange={onChange}
        ariaLabel="Overlay width"
      />,
    );
    const slider = screen.getByLabelText('Overlay width');

    fireEvent.touchEnd(slider);
    fireEvent.blur(slider);
    fireEvent.keyUp(slider);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits on touch end, blur and key up', () => {
    const onChange = vi.fn();
    render(
      <NumberSlider
        value={10}
        min={0}
        max={100}
        onChange={onChange}
        ariaLabel="Overlay width"
      />,
    );
    const slider = screen.getByLabelText('Overlay width', {
      selector: 'input',
    });

    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.touchEnd(slider);
    expect(onChange).toHaveBeenCalledWith(30);

    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.blur(slider);
    expect(onChange).toHaveBeenCalledWith(40);

    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.keyUp(slider);
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it('honours an explicit step', () => {
    const onChange = vi.fn();
    render(
      <NumberSlider
        value={10}
        min={0}
        max={100}
        step={5}
        onChange={onChange}
        ariaLabel="Overlay width"
      />,
    );
    const slider = screen.getByLabelText('Overlay width', {
      selector: 'input',
    });
    expect(slider).toHaveAttribute('step', '5');
  });

  it('syncs with the value prop when not dragging', () => {
    const { container, rerender } = render(
      <NumberSlider
        value={10}
        min={0}
        max={100}
        unit="px"
        onChange={vi.fn()}
        ariaLabel="Overlay width"
      />,
    );
    expect(container.textContent).toContain('10 px');

    rerender(
      <NumberSlider
        value={25}
        min={0}
        max={100}
        unit="px"
        onChange={vi.fn()}
        ariaLabel="Overlay width"
      />,
    );
    expect(container.textContent).toContain('25 px');
  });

  it('ignores value prop changes while dragging', () => {
    const { container, rerender } = render(
      <NumberSlider
        value={10}
        min={0}
        max={100}
        onChange={vi.fn()}
        ariaLabel="Overlay width"
      />,
    );
    fireEvent.change(screen.getByLabelText('Overlay width'), {
      target: { value: '60' },
    });

    rerender(
      <NumberSlider
        value={99}
        min={0}
        max={100}
        onChange={vi.fn()}
        ariaLabel="Overlay width"
      />,
    );
    expect(container.textContent).toContain('60');
  });
});

describe('NumberStepper', () => {
  it('steps the value down and up', () => {
    const onChange = vi.fn();
    render(
      <NumberStepper
        value={5}
        min={1}
        max={10}
        onChange={onChange}
        ariaLabel="Max images"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('disables the buttons at the bounds', () => {
    const { rerender } = render(
      <NumberStepper
        value={1}
        min={1}
        max={10}
        onChange={vi.fn()}
        ariaLabel="Max images"
      />,
    );
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled();

    rerender(
      <NumberStepper
        value={10}
        min={1}
        max={10}
        onChange={vi.fn()}
        ariaLabel="Max images"
      />,
    );
    expect(screen.getByRole('button', { name: 'Increase' })).toBeDisabled();
  });

  it('honours an explicit step', () => {
    const onChange = vi.fn();
    render(
      <NumberStepper
        value={10}
        min={1}
        max={100}
        step={5}
        onChange={onChange}
        ariaLabel="Max images"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenCalledWith(15);
  });
});

describe('Dropdown', () => {
  it('renders raw option values without a formatter', () => {
    const onChange = vi.fn();
    render(
      <Dropdown
        value="openai"
        options={['openai', 'anthropic'] as const}
        onChange={onChange}
        ariaLabel="Chat provider"
      />,
    );
    const select = screen.getByLabelText('Chat provider');
    expect(select).toHaveValue('openai');

    fireEvent.change(select, { target: { value: 'anthropic' } });
    expect(onChange).toHaveBeenCalledWith('anthropic');
    expect(
      screen.getByRole('option', { name: 'anthropic' }),
    ).toBeInTheDocument();
  });

  it('uses the formatter for option labels', () => {
    render(
      <Dropdown
        value="zh"
        options={['en', 'zh'] as const}
        onChange={vi.fn()}
        ariaLabel="Language"
        formatOption={(option) => (option === 'zh' ? 'Chinese' : 'English')}
      />,
    );
    expect(screen.getByRole('option', { name: 'Chinese' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
  });
});

describe('SavedPill', () => {
  it('toggles its visible class', () => {
    const { rerender } = render(<SavedPill visible={false} />);
    const pill = screen.getByRole('status');
    expect(pill.className).not.toContain('Visible');

    rerender(<SavedPill visible />);
    expect(screen.getByRole('status').className).toContain('Visible');
  });
});

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Reset?"
        message="All gone"
        confirmLabel="Reset"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the title, message and buttons', () => {
    render(
      <ConfirmDialog
        open
        title="Reset?"
        message="All gone"
        confirmLabel="Reset"
        destructive
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Reset?')).toBeInTheDocument();
    expect(screen.getByText('All gone')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('honours a custom cancel label', () => {
    render(
      <ConfirmDialog
        open
        title="Reset?"
        message="All gone"
        confirmLabel="Reset"
        cancelLabel="Nope"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Nope')).toBeInTheDocument();
  });

  it('calls onConfirm and onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Reset?"
        message="All gone"
        confirmLabel="Reset"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on Escape and ignores other keys', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Reset?"
        message="All gone"
        confirmLabel="Reset"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: 'a' });
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
