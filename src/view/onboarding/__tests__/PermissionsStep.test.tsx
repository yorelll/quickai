import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionsStep } from '../PermissionsStep';
import { invoke } from '../../../testUtils/mocks/tauri';

describe('PermissionsStep', () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockResolvedValue(undefined);
  });

  it('renders the title', () => {
    render(<PermissionsStep />);
    expect(screen.getByText("Let's get QuickAI set up")).toBeInTheDocument();
  });

  it('explains that no permissions are needed on Windows', () => {
    render(<PermissionsStep />);
    expect(
      screen.getByText("QuickAI doesn't need extra permissions on Windows."),
    ).toBeInTheDocument();
  });

  it('presents the activation hotkey instead of macOS permission cards', () => {
    render(<PermissionsStep />);
    expect(screen.getByText('Activation hotkey')).toBeInTheDocument();
    expect(
      screen.getByText('Double-tap Ctrl from any app to summon QuickAI'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Ctrl')).toHaveLength(2);
    expect(screen.queryByText('Accessibility')).toBeNull();
    expect(screen.queryByText('Screen Recording')).toBeNull();
  });

  it('offers Quit & Reopen to complete setup', () => {
    render(<PermissionsStep />);
    expect(
      screen.getByRole('button', { name: /quit & reopen quickai/i }),
    ).toBeInTheDocument();
  });

  it('calls quit_and_relaunch when the CTA is clicked', async () => {
    render(<PermissionsStep />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /quit & reopen quickai/i }),
      );
    });

    expect(invoke).toHaveBeenCalledWith('quit_and_relaunch');
  });

  it('brightens the CTA on hover', () => {
    render(<PermissionsStep />);
    const button = screen.getByRole('button', {
      name: /quit & reopen quickai/i,
    });

    fireEvent.mouseEnter(button);
    expect(button.style.filter).toBe('brightness(1.1)');

    fireEvent.mouseLeave(button);
    expect(button.style.filter).toBe('none');
  });
});
