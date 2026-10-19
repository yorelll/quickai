import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConnectionTest, connectionErrorKey } from '../ConnectionTest';
import { invoke } from '../../../testUtils/mocks/tauri';
import { setLocale } from '../../../i18n';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Installs a `test_connection` double that answers with `result`. */
function installBackend(result: unknown | Promise<unknown>) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd !== 'test_connection') return undefined;
    return result;
  });
}

const status = () => screen.getByRole('status', { name: 'Connection status' });

const testButton = () =>
  screen.getByRole('button', { name: 'Test connection' });

async function runProbe(result: unknown | Promise<unknown>) {
  installBackend(result);
  render(<ConnectionTest />);
  fireEvent.click(testButton());
  await act(async () => {});
}

describe('ConnectionTest', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    setLocale('en');
  });

  it('defaults to the never-tested state', () => {
    installBackend({ status: 'success' });
    render(<ConnectionTest />);

    expect(status()).toHaveTextContent('Not yet tested');
    expect(testButton()).toBeEnabled();
  });

  it('reports a successful probe', async () => {
    await runProbe({ status: 'success' });

    expect(mockInvoke).toHaveBeenCalledWith('test_connection', {
      scope: 'chat',
    });
    expect(status()).toHaveTextContent('Connected');
  });

  it('localizes a known failure code and shows the raw detail', async () => {
    await runProbe({
      status: 'failure',
      code: 'network',
      message: 'dns lookup failed',
    });

    expect(status()).toHaveTextContent(
      "Couldn't reach the provider. Check your connection.",
    );
    expect(screen.getByText('dns lookup failed')).toBeInTheDocument();
  });

  it.each([
    ['bad_request', 'The provider rejected the request.'],
    ['forbidden', 'The provider denied access to this model.'],
  ])('renders the %s code with generic copy', async (code, copy) => {
    // Capability detection degrades to these codes when the provider phrases
    // the rejection differently, so they must never render blank.
    await runProbe({ status: 'failure', code, message: 'raw detail' });
    expect(status()).toHaveTextContent(copy);
    expect(screen.getByText('raw detail')).toBeInTheDocument();
  });

  it('renders the unsupported-capability code the shared map does not know', async () => {
    await runProbe({
      status: 'failure',
      code: 'unsupported_capability',
      message: 'streaming is not supported by this model',
    });

    expect(status()).toHaveTextContent(
      'The provider rejected the request: this model or endpoint does not support the capability QuickAI needs.',
    );
    expect(
      screen.getByText('streaming is not supported by this model'),
    ).toBeInTheDocument();
  });

  it('shows the raw detail as the label for a code it cannot name', async () => {
    await runProbe({
      status: 'failure',
      code: 'brand_new_code',
      message: 'something unusual',
    });

    expect(status()).toHaveTextContent('something unusual');
    // The raw text is the label, so it is not repeated as a subtitle.
    expect(screen.getAllByText('something unusual')).toHaveLength(1);
  });

  it('reports a rejected promise as an unnamed failure', async () => {
    mockInvoke.mockImplementation(async () => {
      throw new Error('database lock poisoned');
    });
    render(<ConnectionTest />);
    fireEvent.click(testButton());
    await act(async () => {});

    expect(status()).toHaveTextContent('Something went wrong.');
    expect(
      screen.getByText('Error: database lock poisoned'),
    ).toBeInTheDocument();
  });

  it('disables the control while a probe is in flight', async () => {
    const d = deferred<unknown>();
    installBackend(d.promise);
    render(<ConnectionTest />);

    fireEvent.click(testButton());
    expect(status()).toHaveTextContent('Testing…');
    expect(testButton()).toBeDisabled();

    await act(async () => {
      d.resolve({ status: 'success' });
    });
    expect(status()).toHaveTextContent('Connected');
    expect(testButton()).toBeEnabled();
  });

  it('replaces a previous verdict on a later probe', async () => {
    installBackend({
      status: 'failure',
      code: 'unauthorized',
      message: 'bad key',
    });
    render(<ConnectionTest />);
    fireEvent.click(testButton());
    await act(async () => {});
    expect(status()).toHaveTextContent(
      'Authentication failed. Check your API key.',
    );

    installBackend({ status: 'success' });
    fireEvent.click(testButton());
    await act(async () => {});
    expect(status()).toHaveTextContent('Connected');
    expect(screen.queryByText('bad key')).toBeNull();
  });

  describe('connectionErrorKey', () => {
    it('delegates known codes to the shared error mapping', () => {
      expect(connectionErrorKey('model_not_found')).toBe('error.modelNotFound');
      expect(connectionErrorKey('missing_api_key')).toBe('error.missingApiKey');
    });

    it('names the capability code itself', () => {
      expect(connectionErrorKey('unsupported_capability')).toBe(
        'error.unsupportedCapability',
      );
    });

    it('returns null for a code it does not know', () => {
      expect(connectionErrorKey('brand_new_code')).toBeNull();
    });
  });
});
