import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ErrorCard, errorTitleKey } from '../ErrorCard';
import { en } from '../../i18n/en';

describe('errorTitleKey', () => {
  it.each([
    ['missing_api_key', 'error.missingApiKey'],
    ['missing_model', 'error.missingModel'],
    ['unauthorized', 'error.unauthorized'],
    ['forbidden', 'error.forbidden'],
    ['rate_limited', 'error.rateLimited'],
    ['server_error', 'error.serverError'],
    ['network', 'error.network'],
    ['model_not_found', 'error.modelNotFound'],
    ['bad_request', 'error.badRequest'],
    ['context_length_exceeded', 'error.contextLengthExceeded'],
    ['cancelled', 'error.cancelled'],
    ['skill_unreadable', 'error.skillUnreadable'],
    ['unknown', 'error.unknown'],
  ] as const)('maps %s to %s', (code, key) => {
    expect(errorTitleKey(code)).toBe(key);
  });

  it('returns null for an unrecognized code', () => {
    expect(errorTitleKey('some_new_code')).toBeNull();
  });
});

describe('ErrorCard', () => {
  it('renders the localized title and the raw message as subtitle', () => {
    render(<ErrorCard code="unauthorized" message="401 from provider" />);
    expect(screen.getByText(en['error.unauthorized'])).toBeInTheDocument();
    expect(screen.getByText('401 from provider')).toBeInTheDocument();
  });

  it('localizes a missing chat model and points the user at Settings', () => {
    render(<ErrorCard code="missing_model" message="no model configured" />);
    expect(screen.getByText(en['error.missingModel'])).toBeInTheDocument();
  });

  it('omits the subtitle when the message is empty', () => {
    const { container } = render(<ErrorCard code="network" message="" />);
    expect(screen.getByText(en['error.network'])).toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('falls back to the raw message when the code is unknown', () => {
    render(<ErrorCard code="weird_code" message="Provider said no" />);
    expect(screen.getByText('Provider said no')).toBeInTheDocument();
  });

  it('uses a muted bar for cancelled and unknown codes', () => {
    const { container } = render(
      <ErrorCard code="cancelled" message="Stopped" />,
    );
    const bar = container.querySelector('[data-error-bar]') as HTMLElement;
    expect(bar.style.background).toBe('var(--color-text-secondary)');
    expect(bar.getAttribute('data-kind')).toBe('cancelled');
  });

  it('uses an amber bar for quota-style errors', () => {
    const { container } = render(
      <ErrorCard code="rate_limited" message="Slow down" />,
    );
    const bar = container.querySelector('[data-error-bar]') as HTMLElement;
    expect(bar.style.background).toBe('var(--color-tertiary)');
  });

  it('uses a red bar for auth failures', () => {
    const { container } = render(
      <ErrorCard code="unauthorized" message="Nope" />,
    );
    const bar = container.querySelector('[data-error-bar]') as HTMLElement;
    expect(bar.style.background).toBe('var(--color-status-error)');
  });
});
