import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { SkillsSection } from '../SkillsSection';
import { invoke } from '../../../testUtils/mocks/tauri';
import type { Skill } from '../../skills';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const BUILTIN: Skill = {
  id: 'builtin-assistant',
  alias: 'assistant',
  path: 'C:\\config\\skills\\assistant.md',
  enabled: true,
};
const TRANSLATE: Skill = {
  id: 's2',
  alias: 'translate',
  path: 'D:\\skills\\translate.md',
  enabled: false,
};

/**
 * Backend double: `set_skills` echoes the whole list back, matching the Rust
 * command (which validates the list and returns the persisted result).
 */
function installBackend(
  list: Skill[],
  options: { loadFails?: boolean; saveFails?: boolean } = {},
) {
  mockInvoke.mockImplementation(
    async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_skills') {
        if (options.loadFails) throw new Error('no skills file');
        return list;
      }
      if (cmd === 'set_skills') {
        if (options.saveFails) throw new Error('disk full');
        return args?.skills;
      }
      return undefined;
    },
  );
}

async function renderSection(
  list: Skill[] = [BUILTIN, TRANSLATE],
  options: { loadFails?: boolean; saveFails?: boolean } = {},
) {
  installBackend(list, options);
  const view = render(<SkillsSection />);
  await act(async () => {});
  return view;
}

const rows = () => screen.getAllByRole('listitem');

/** Adds a skill through the editor and returns nothing; the caller asserts. */
function startAdd() {
  fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
}

function typeAlias(value: string) {
  fireEvent.change(screen.getByLabelText('Alias'), { target: { value } });
}

function typePath(value: string) {
  fireEvent.change(screen.getByLabelText('Path'), { target: { value } });
}

function saveDraft() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('SkillsSection', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('shows only the heading until the list resolves', () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<SkillsSection />);

    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add skill' })).toBeNull();
  });

  it('lists every skill and marks the built-in as undeletable', async () => {
    await renderSection();

    expect(rows()).toHaveLength(2);
    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(
      within(rows()[0]).queryByRole('button', { name: 'Delete skill' }),
    ).toBeNull();
    expect(
      within(rows()[1]).getByRole('button', { name: 'Delete skill' }),
    ).toBeInTheDocument();
  });

  it('shows an empty state when there are no skills', async () => {
    await renderSection([]);
    expect(screen.getByText('No skills yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('reports a failed load and falls back to an empty list', async () => {
    await renderSection([], { loadFails: true });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load skills.",
    );
    expect(screen.getByText('No skills yet.')).toBeInTheDocument();
  });

  it('ignores a load result that lands after unmount', async () => {
    let resolve!: (value: Skill[]) => void;
    mockInvoke.mockImplementation(
      () =>
        new Promise<Skill[]>((res) => {
          resolve = res;
        }),
    );
    const { unmount } = render(<SkillsSection />);
    unmount();

    await act(async () => {
      resolve([BUILTIN]);
    });

    expect(screen.queryByText('assistant')).toBeNull();
  });

  it('ignores a load failure that lands after unmount', async () => {
    let reject!: (reason: unknown) => void;
    mockInvoke.mockImplementation(
      () =>
        new Promise<Skill[]>((_, rej) => {
          reject = rej;
        }),
    );
    const { unmount } = render(<SkillsSection />);
    unmount();

    await act(async () => {
      reject(new Error('late'));
    });

    expect(screen.queryByRole('list')).toBeNull();
  });

  it('toggles a skill into the system prompt', async () => {
    await renderSection();
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Use translate as a system prompt',
      }),
    );
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [BUILTIN, { ...TRANSLATE, enabled: true }],
    });
  });

  it('deletes a skill', async () => {
    await renderSection();
    fireEvent.click(
      within(rows()[1]).getByRole('button', { name: 'Delete skill' }),
    );
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [BUILTIN],
    });
  });

  it('surfaces a failed save and keeps the list', async () => {
    await renderSection([BUILTIN, TRANSLATE], { saveFails: true });
    fireEvent.click(
      within(rows()[1]).getByRole('button', { name: 'Delete skill' }),
    );
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't save skills. Please try again.",
    );
    expect(rows()).toHaveLength(2);
  });

  it('reorders with the move buttons and disables them at the bounds', async () => {
    await renderSection();

    expect(
      within(rows()[0]).getByRole('button', { name: 'Move up' }),
    ).toBeDisabled();
    expect(
      within(rows()[1]).getByRole('button', { name: 'Move down' }),
    ).toBeDisabled();

    fireEvent.click(
      within(rows()[0]).getByRole('button', { name: 'Move down' }),
    );
    await act(async () => {});
    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [TRANSLATE, BUILTIN],
    });

    // The list now reads [translate, assistant]; move the second row up.
    fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Move up' }));
    await act(async () => {});
    expect(mockInvoke).toHaveBeenLastCalledWith('set_skills', {
      skills: [BUILTIN, TRANSLATE],
    });
  });

  it('reorders by dragging a row onto another', async () => {
    await renderSection();

    fireEvent.dragStart(rows()[1]);
    fireEvent.dragOver(rows()[0]);
    fireEvent.drop(rows()[0]);
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [TRANSLATE, BUILTIN],
    });
  });

  it('ignores a drop onto itself or without a drag', async () => {
    await renderSection();

    fireEvent.dragStart(rows()[0]);
    fireEvent.drop(rows()[0]);
    fireEvent.drop(rows()[0]);
    await act(async () => {});

    expect(mockInvoke).not.toHaveBeenCalledWith(
      'set_skills',
      expect.anything(),
    );
  });

  it('adds a skill once the alias and path are valid', async () => {
    await renderSection();
    startAdd();

    expect(rows()).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Add skill' })).toBeDisabled();

    typeAlias('gamma');
    typePath('D:\\skills\\gamma.md');
    saveDraft();
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [
        BUILTIN,
        TRANSLATE,
        expect.objectContaining({
          alias: 'gamma',
          path: 'D:\\skills\\gamma.md',
          enabled: false,
        }),
      ],
    });
    expect(screen.queryByLabelText('Alias')).toBeNull();
  });

  it('adds the first skill to an empty list', async () => {
    await renderSection([]);
    startAdd();

    expect(rows()).toHaveLength(1);
    typeAlias('assistant');
    typePath('C:\\skills\\assistant.md');
    saveDraft();
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [expect.objectContaining({ alias: 'assistant', enabled: false })],
    });
  });

  it('rejects an empty alias', async () => {
    await renderSection();
    startAdd();
    saveDraft();

    expect(screen.getByRole('alert')).toHaveTextContent('Enter an alias.');
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'set_skills',
      expect.anything(),
    );
  });

  it('rejects an alias containing whitespace', async () => {
    await renderSection();
    startAdd();
    typeAlias('two words');
    saveDraft();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The alias cannot contain spaces.',
    );
  });

  it('rejects a duplicate alias', async () => {
    await renderSection();
    startAdd();
    typeAlias('translate');
    saveDraft();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That alias is already in use.',
    );
  });

  it('keeps the editor open when the save fails', async () => {
    await renderSection([BUILTIN, TRANSLATE], { saveFails: true });
    startAdd();
    typeAlias('gamma');
    saveDraft();
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't save skills. Please try again.",
    );
    expect(screen.getByLabelText('Alias')).toBeInTheDocument();
  });

  it('edits a skill and cancels without saving', async () => {
    await renderSection();

    fireEvent.click(
      within(rows()[1]).getByRole('button', { name: 'Edit skill' }),
    );
    expect(screen.getByLabelText('Alias')).toHaveValue('translate');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Alias')).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'set_skills',
      expect.anything(),
    );

    fireEvent.click(
      within(rows()[1]).getByRole('button', { name: 'Edit skill' }),
    );
    typeAlias('translated');
    saveDraft();
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [BUILTIN, { ...TRANSLATE, alias: 'translated' }],
    });
  });

  it('lets a skill keep its own alias while editing', async () => {
    await renderSection();
    fireEvent.click(
      within(rows()[1]).getByRole('button', { name: 'Edit skill' }),
    );
    saveDraft();
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_skills', {
      skills: [BUILTIN, TRANSLATE],
    });
  });
});
