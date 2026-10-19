import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AskBarView } from '../AskBarView';
import type { AttachedImage } from '../../types/image';

function makeRef(): React.RefObject<HTMLTextAreaElement | null> {
  return { current: null };
}

/** Helper to create an AttachedImage with defaults. */
function makeImage(overrides: Partial<AttachedImage> = {}): AttachedImage {
  return {
    id: overrides.id ?? 'test-id',
    blobUrl: overrides.blobUrl ?? 'blob:http://localhost/test',
    filePath: overrides.filePath ?? '/tmp/img.jpg',
    ...overrides,
  };
}

/** Default image-related props shared across all AskBarView test renders. */
const IMAGE_DEFAULTS = {
  attachedImages: [] as AttachedImage[],
  onImagesAttached: vi.fn(),
  onImageRemove: vi.fn(),
  onImagePreview: vi.fn(),
  onScreenshot: vi.fn(),
};

describe('AskBarView', () => {
  it('renders textarea with placeholder for input bar mode', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    expect(textarea).not.toBeNull();
  });

  it('renders textarea with chat mode placeholder', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const textarea = screen.getByPlaceholderText('Reply...');
    expect(textarea).not.toBeNull();
  });

  it('calls setQuery on textarea change', () => {
    const setQuery = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={setQuery}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(setQuery).toHaveBeenCalledWith('hello');
  });

  it('disables textarea during generation', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('calls onSubmit on Enter key', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit on Shift+Enter', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      'Ask a question, or type / to see commands',
    );
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit on button click', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows logo at 40px in input bar mode (w-10 h-10 rounded-lg classes)', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const logo = container.querySelector('img[alt="QuickAI"]');
    expect(logo).not.toBeNull();
    expect(logo?.classList.contains('w-10')).toBe(true);
    expect(logo?.classList.contains('h-10')).toBe(true);
    expect(logo?.classList.contains('rounded-lg')).toBe(true);
  });

  it('shows logo at 24px in chat mode (w-6 h-6 rounded-lg classes)', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const logo = container.querySelector('img[alt="QuickAI"]');
    expect(logo).not.toBeNull();
    expect(logo?.classList.contains('w-6')).toBe(true);
    expect(logo?.classList.contains('h-6')).toBe(true);
    expect(logo?.classList.contains('rounded-lg')).toBe(true);
  });

  it('shows send button with accessible label', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).toBeInTheDocument();
  });

  it('displays selectedText when provided', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        selectedText="some highlighted text"
      />,
    );
    expect(screen.getByText(/some highlighted text/)).toBeInTheDocument();
  });

  it('hides context area when no selectedText', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    // The context area uses italic + whitespace-pre-wrap; mirror div also uses
    // whitespace-pre-wrap but is aria-hidden, so check for the italic class.
    expect(container.querySelector('.italic.whitespace-pre-wrap')).toBeNull();
  });

  it('shows stop button with accessible label during generation', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Stop generating' }),
    ).toBeInTheDocument();
  });

  it('calls onCancel when stop button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={onCancel}
        inputRef={makeRef()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('applies spinning ring class to stop button', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Stop generating' });
    expect(btn.classList.contains('stop-btn-ring')).toBe(true);
  });

  it('does not call onSubmit when stop button is clicked during generation', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('displays selectedText with whitespace-pre-wrap class', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        selectedText="context text here"
      />,
    );
    const el = container.querySelector('.whitespace-pre-wrap');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('context text here');
  });

  describe('history icon button', () => {
    it('renders history icon button in ask-bar mode when onHistoryOpen is provided', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onHistoryOpen={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: /history/i }),
      ).toBeInTheDocument();
    });

    it('does not render history icon button in chat mode', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onHistoryOpen={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: /history/i })).toBeNull();
    });

    it('calls onHistoryOpen when history button is clicked', () => {
      const onHistoryOpen = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onHistoryOpen={onHistoryOpen}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /history/i }));
      expect(onHistoryOpen).toHaveBeenCalledOnce();
    });
  });

  describe('image attachments', () => {
    it('renders image thumbnails when attachedImages is non-empty', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[
            makeImage({ id: 'img-1', blobUrl: 'blob:http://localhost/1' }),
            makeImage({ id: 'img-2', blobUrl: 'blob:http://localhost/2' }),
          ]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('list', { name: /attached images/i }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('does not render thumbnails when attachedImages is empty', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('enables submit button when images are attached even without text', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1' })]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Send message' });
      expect(btn).not.toBeDisabled();
    });

    it('calls onImagePreview when thumbnail is clicked', () => {
      const onImagePreview = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1' })]}
          onImagePreview={onImagePreview}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /preview/i }));
      expect(onImagePreview).toHaveBeenCalledWith('img-1');
    });

    it('calls onImageRemove when remove button is clicked', () => {
      const onImageRemove = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1' })]}
          onImageRemove={onImageRemove}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      expect(onImageRemove).toHaveBeenCalledWith('img-1');
    });

    it('applies violet ring when isDragOver is "normal"', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="normal"
        />,
      );
      const wrapper = container.firstElementChild!;
      expect(wrapper.classList.contains('ring-2')).toBe(true);
      expect(wrapper.classList.contains('ring-status-error/60')).toBe(false);
    });

    it('does not apply ring when isDragOver is undefined', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const wrapper = container.firstElementChild!;
      expect(wrapper.classList.contains('ring-2')).toBe(false);
    });

    it('applies red ring when isDragOver is "max"', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="max"
        />,
      );
      const wrapper = container.firstElementChild!;
      expect(wrapper.classList.contains('ring-2')).toBe(true);
      expect(wrapper.classList.contains('ring-status-error/60')).toBe(true);
    });

    it('shows "Max 3 images" label when isDragOver is "max"', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="max"
        />,
      );
      expect(screen.getByText('Max 3 images')).toBeInTheDocument();
    });

    it('does not show max label when isDragOver is "normal"', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="normal"
        />,
      );
      expect(screen.queryByText('Max 3 images')).toBeNull();
    });

    describe('paste at max images', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('shows error message when paste attempted at max images', () => {
        const onImagesAttached = vi.fn();
        render(
          <AskBarView
            {...IMAGE_DEFAULTS}
            attachedImages={[
              makeImage({ id: 'a' }),
              makeImage({ id: 'b' }),
              makeImage({ id: 'c' }),
            ]}
            onImagesAttached={onImagesAttached}
            query=""
            setQuery={vi.fn()}
            isChatMode={false}
            isGenerating={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            inputRef={makeRef()}
          />,
        );
        const textarea = screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        );
        const file = new File(['x'], 'img.png', { type: 'image/png' });
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
        expect(onImagesAttached).not.toHaveBeenCalled();
        expect(screen.getByText('Max 3 images')).toBeInTheDocument();
      });

      it('paste error message auto-dismisses after 2 seconds', () => {
        render(
          <AskBarView
            {...IMAGE_DEFAULTS}
            attachedImages={[
              makeImage({ id: 'a' }),
              makeImage({ id: 'b' }),
              makeImage({ id: 'c' }),
            ]}
            onImagesAttached={vi.fn()}
            query=""
            setQuery={vi.fn()}
            isChatMode={false}
            isGenerating={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            inputRef={makeRef()}
          />,
        );
        const textarea = screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        );
        const file = new File(['x'], 'img.png', { type: 'image/png' });
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
        expect(screen.getByText('Max 3 images')).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(screen.queryByText('Max 3 images')).toBeNull();
      });

      it('does not show paste error when pasting non-image content at max images', () => {
        render(
          <AskBarView
            {...IMAGE_DEFAULTS}
            attachedImages={[
              makeImage({ id: 'a' }),
              makeImage({ id: 'b' }),
              makeImage({ id: 'c' }),
            ]}
            onImagesAttached={vi.fn()}
            query=""
            setQuery={vi.fn()}
            isChatMode={false}
            isGenerating={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            inputRef={makeRef()}
          />,
        );
        const textarea = screen.getByPlaceholderText(
          'Ask a question, or type / to see commands',
        );
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ type: 'text/plain', getAsFile: () => null }],
          },
        });
        expect(screen.queryByText('Max 3 images')).toBeNull();
      });
    });

    it('calls onImagesAttached on paste with image', async () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['fake-img'], 'test.png', { type: 'image/png' });
      const clipboardData = {
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      // FileReader is async — wait for the next microtask.
      await vi.waitFor(() => {
        expect(onImagesAttached).toHaveBeenCalledTimes(1);
      });
    });

    it('does not call onImagesAttached on paste with text only', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const clipboardData = {
        items: [{ type: 'text/plain', getAsFile: () => null }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('ignores paste when clipboard has no items', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.paste(textarea, { clipboardData: { items: null } });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('ignores paste when generating', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['x'], 'img.png', { type: 'image/png' });
      const clipboardData = {
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('skips image items where getAsFile returns null', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const clipboardData = {
        items: [{ type: 'image/png', getAsFile: () => null }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('respects max image limit during paste', async () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[
            makeImage({ id: 'a' }),
            makeImage({ id: 'b' }),
            makeImage({ id: 'c' }),
          ]}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['x'], 'img.png', { type: 'image/png' });
      const clipboardData = {
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      // Should not process since we're already at max.
      expect(onImagesAttached).not.toHaveBeenCalled();
    });
  });

  describe('screenshot button', () => {
    it('renders screenshot button with correct aria-label', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take a screenshot' }),
      ).not.toBeNull();
    });

    it('calls onScreenshot when clicked', () => {
      const onScreenshot = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onScreenshot={onScreenshot}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Take a screenshot' }),
      );
      expect(onScreenshot).toHaveBeenCalledOnce();
    });

    it('is disabled while generating', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take a screenshot' }),
      ).toBeDisabled();
    });

    it('is disabled while submit is pending', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take a screenshot' }),
      ).toBeDisabled();
    });

    it('is disabled when max images are already attached', () => {
      const maxImages = [
        makeImage({ id: '1' }),
        makeImage({ id: '2' }),
        makeImage({ id: '3' }),
      ];
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={maxImages}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take a screenshot' }),
      ).toBeDisabled();
    });

    it('is enabled when fewer than max images are attached', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage()]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take a screenshot' }),
      ).not.toBeDisabled();
    });

    it('renders in chat mode', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take a screenshot' }),
      ).not.toBeNull();
    });

    it('has no hover classes when max images are attached', () => {
      const maxImages = [
        makeImage({ id: '1' }),
        makeImage({ id: '2' }),
        makeImage({ id: '3' }),
      ];
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={maxImages}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take a screenshot' });
      expect(btn.className).not.toContain('hover:text-text-primary');
      expect(btn.className).not.toContain('hover:bg-surface-elevated');
    });

    it('has hover classes when below max images', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage()]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take a screenshot' });
      expect(btn.className).toContain('hover:text-text-primary');
      expect(btn.className).toContain('hover:bg-surface-elevated');
    });

    it('shows tooltip explaining limit when camera button is hovered at max images', () => {
      const maxImages = [
        makeImage({ id: '1' }),
        makeImage({ id: '2' }),
        makeImage({ id: '3' }),
      ];
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={maxImages}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take a screenshot' });
      fireEvent.mouseEnter(btn.parentElement!);
      expect(screen.getByText('Maximum 3 images attached')).toBeInTheDocument();
    });

    it('does not show max-images tooltip when below max images', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage()]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.queryByText('Maximum 3 images attached'),
      ).not.toBeInTheDocument();
    });

    it('shows screenshot tooltip on hover when below max images', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take a screenshot' });
      fireEvent.mouseEnter(btn.parentElement!);
      expect(screen.getByText('Take a screenshot')).toBeInTheDocument();
    });
  });

  describe('isSubmitPending state', () => {
    it('shows stop button when isSubmitPending is true', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1', filePath: null })]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: /stop/i });
      expect(btn).toBeInTheDocument();
      expect(btn.classList.contains('stop-btn-ring')).toBe(true);
    });

    it('disables textarea when isSubmitPending is true', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
    });

    it('ignores paste when isSubmitPending', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      const file = new File(['x'], 'img.png', { type: 'image/png' });
      const clipboardData = {
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });
  });

  describe('command suggestion popover', () => {
    function renderWithQuery(query: string, busy = false) {
      const setQuery = vi.fn();
      const { rerender } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query={query}
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={busy}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      return { setQuery, rerender };
    }

    it('shows CommandSuggestion when query starts with "/"', () => {
      renderWithQuery('/');
      expect(
        screen.getByRole('listbox', { name: /command suggestions/i }),
      ).toBeInTheDocument();
    });

    it('shows CommandSuggestion for partial trigger "/sc"', () => {
      renderWithQuery('/sc');
      expect(
        screen.getByRole('listbox', { name: /command suggestions/i }),
      ).toBeInTheDocument();
      expect(screen.getByText('/screen')).toBeInTheDocument();
    });

    it('does not show CommandSuggestion when query does not start with "/"', () => {
      renderWithQuery('hello');
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('does not show CommandSuggestion when query has a space after the trigger', () => {
      renderWithQuery('/screen ');
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('does not show CommandSuggestion when busy (generating)', () => {
      renderWithQuery('/screen', true);
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('Tab key calls setQuery with trigger + space when suggestion is visible', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/sc"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(setQuery).toHaveBeenCalledWith('/screen ');
    });

    it('Enter on highlighted row completes the trigger instead of submitting', () => {
      const onSubmit = vi.fn();
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/sc"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(setQuery).toHaveBeenCalledWith('/screen ');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Enter submits when query exactly matches the highlighted trigger', () => {
      const onSubmit = vi.fn();
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screen"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(setQuery).not.toHaveBeenCalled();
    });

    it('Escape dismisses suggestions without changing query', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/sc"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Escape' });
      // setQuery is NOT called (query is unchanged)
      expect(setQuery).not.toHaveBeenCalled();
      // Suggestion popover is no longer rendered
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('ArrowDown moves highlight to next row', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      // Initially row 0 is highlighted (only one command, so index stays 0)
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      // ArrowDown from index 0 moves to index 1
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowUp moves highlight to previous row (wraps)', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      // ArrowUp wraps to the last option
      const options = screen.getAllByRole('option');
      const lastOption = options[options.length - 1];
      expect(lastOption).toHaveAttribute('aria-selected', 'true');
    });

    it('clicking a suggestion row calls setQuery with trigger + space', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const options = screen.getAllByRole('option');
      fireEvent.mouseDown(options[0]);
      expect(setQuery).toHaveBeenCalledWith('/screen ');
    });

    it('Tab does nothing when suggestions are not shown', () => {
      const onSubmit = vi.fn();
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="hello"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(setQuery).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Escape does nothing when suggestions are not shown', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="hello"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(setQuery).not.toHaveBeenCalled();
    });

    it('shows "No commands found" when prefix matches nothing', () => {
      renderWithQuery('/xyz');
      expect(screen.getByText('No commands found')).toBeInTheDocument();
    });

    it('Enter falls through to submit when suggestion list is empty', () => {
      const onSubmit = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/xyz"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('ArrowDown and ArrowUp do nothing when filtered list is empty', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/xyz"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      // Should not throw
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      // Still shows "No commands found"
      expect(screen.getByText('No commands found')).toBeInTheDocument();
    });

    it('Tab does nothing when filtered list is empty', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/xyz"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(setQuery).not.toHaveBeenCalled();
    });
  });

  describe('Command highlighting mirror div', () => {
    it('renders a mirror div with aria-hidden behind the textarea', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screen explain"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const mirror = container.querySelector('[aria-hidden="true"]');
      expect(mirror).not.toBeNull();
      expect(mirror!.classList.contains('pointer-events-none')).toBe(true);
    });

    it('highlights /screen command in the brand colour in the mirror div', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screen explain this"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const mirror = container.querySelector('[aria-hidden="true"]');
      const highlighted = mirror!.querySelector('.text-primary');
      expect(highlighted).not.toBeNull();
      expect(highlighted!.textContent).toBe('/screen');
    });

    it('highlights multiple commands in the mirror div', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screen /think explain"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const mirror = container.querySelector('[aria-hidden="true"]');
      const highlighted = mirror!.querySelectorAll('.text-primary');
      expect(highlighted).toHaveLength(2);
      expect(highlighted[0].textContent).toBe('/screen');
      expect(highlighted[1].textContent).toBe('/think');
    });

    it('does not highlight partial command matches like /screensaver', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screensaver is nice"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const mirror = container.querySelector('[aria-hidden="true"]');
      expect(mirror!.querySelector('.text-primary')).toBeNull();
      expect(mirror!.textContent).toBe('/screensaver is nice');
    });

    it('renders plain text in mirror div when no commands present', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="hello world"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const mirror = container.querySelector('[aria-hidden="true"]');
      expect(mirror!.querySelector('.text-primary')).toBeNull();
      expect(mirror!.textContent).toBe('hello world');
    });

    it('makes the textarea text transparent for the mirror overlay', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/think test"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = container.querySelector('textarea');
      expect(textarea!.classList.contains('text-transparent')).toBe(true);
      expect(textarea!.style.caretColor).toBe('var(--color-text-primary)');
    });

    it('handles scroll event gracefully when refs are not yet set', () => {
      // Render with a ref that has current = null to exercise the null guard
      const nullRef = { current: null };
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screen test"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={nullRef}
        />,
      );
      // The textarea is rendered by React, but the inputRef.current is null
      // because we passed a ref with current=null that was not wired via callback.
      // The scroll handler should not throw.
      const textarea = container.querySelector('textarea')!;
      expect(() => fireEvent.scroll(textarea)).not.toThrow();
    });

    it('syncs mirror div scroll with textarea scroll', () => {
      const ref = makeRef();
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screen long text here"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={ref}
        />,
      );
      const textarea = container.querySelector('textarea')!;
      const mirror = container.querySelector('[aria-hidden="true"]')!;

      // Simulate scrolling
      Object.defineProperty(textarea, 'scrollTop', {
        value: 42,
        writable: true,
      });
      fireEvent.scroll(textarea);
      expect(mirror.scrollTop).toBe(42);
    });
  });

  describe('icon tooltips', () => {
    it('shows the history tooltip on hover', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onHistoryOpen={vi.fn()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Open history' });
      fireEvent.mouseEnter(btn.parentElement!);
      expect(
        screen.getByText('Conversation history (Ctrl+H)'),
      ).toBeInTheDocument();
    });

    it('shows the settings tooltip on hover', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onSettingsOpen={vi.fn()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Open settings' });
      fireEvent.mouseEnter(btn.parentElement!);
      expect(screen.getByText('Open settings')).toBeInTheDocument();
    });
  });

  describe('skill picker (/add)', () => {
    const SKILLS = [
      { id: 's1', alias: 'assistant', path: '/a.md', enabled: true },
      { id: 's2', alias: 'translate', path: '/b.md', enabled: false },
      { id: 's3', alias: 'summarize', path: '/c.md', enabled: false },
    ];

    function renderWithQuery(
      query: string,
      options: {
        skills?: typeof SKILLS;
        onSkillAdd?: (alias: string) => void;
        busy?: boolean;
      } = {},
    ) {
      const setQuery = vi.fn();
      const onSkillAdd = options.onSkillAdd ?? vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query={query}
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={options.busy ?? false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          skills={options.skills ?? SKILLS}
          selectedSkills={[]}
          onSkillAdd={onSkillAdd}
          onSkillRemove={vi.fn()}
        />,
      );
      return { setQuery, onSkillAdd };
    }

    it('shows the picker when the query ends with a bare /add', () => {
      renderWithQuery('/add');
      expect(
        screen.getByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeInTheDocument();
      expect(screen.getByText('translate')).toBeInTheDocument();
    });

    it('lists every configured skill', () => {
      renderWithQuery('/add');
      expect(screen.getByText('assistant')).toBeInTheDocument();
      expect(screen.getByText('translate')).toBeInTheDocument();
      expect(screen.getByText('summarize')).toBeInTheDocument();
    });

    it('opens with the highlight on the first addable skill', () => {
      renderWithQuery('/add');
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('opens with no selection when every skill is enabled', () => {
      renderWithQuery('/add', {
        skills: [SKILLS[0]],
      });
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
    });

    it('suppresses the command popover while the picker is open', () => {
      renderWithQuery('/add');
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('shows the empty state when no skills are configured', () => {
      renderWithQuery('/add', { skills: [] });
      expect(screen.getByText('No skills configured')).toBeInTheDocument();
    });

    it('does not show the picker when busy (generating)', () => {
      renderWithQuery('/add', { busy: true });
      expect(
        screen.queryByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeNull();
    });

    it('shows the picker for /add completed with a trailing space', () => {
      renderWithQuery('/add ');
      expect(
        screen.getByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeInTheDocument();
    });

    it('does not show the picker when /add is followed by more text', () => {
      renderWithQuery('/add translate');
      expect(
        screen.queryByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeNull();
    });

    it('ArrowDown moves the highlight to the next row', () => {
      renderWithQuery('/add');
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      const options = screen.getAllByRole('option');
      expect(options[2]).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowUp walks onto enabled rows and wraps around', () => {
      renderWithQuery('/add');
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      // Up from the first addable row lands on the enabled built-in.
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      let options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-disabled', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');

      // Up again wraps past it to the last row.
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      options = screen.getAllByRole('option');
      expect(options[2]).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowDown and ArrowUp do nothing when no skills are configured', () => {
      renderWithQuery('/add', { skills: [] });
      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      expect(screen.getByText('No skills configured')).toBeInTheDocument();
    });

    it('Enter adds the highlighted skill and clears the /add word', () => {
      const onSkillAdd = vi.fn();
      const { setQuery } = renderWithQuery('/add', { onSkillAdd });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(onSkillAdd).toHaveBeenCalledWith('translate');
      expect(setQuery).toHaveBeenCalledWith('');
    });

    it('Enter on an enabled skill does not add it and stays in the picker', () => {
      const onSkillAdd = vi.fn();
      const { setQuery } = renderWithQuery('/add', { onSkillAdd });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      // Up onto the enabled built-in row.
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(onSkillAdd).not.toHaveBeenCalled();
      expect(setQuery).not.toHaveBeenCalled();
      expect(
        screen.getByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeInTheDocument();
    });

    it('marks an enabled skill as inert with an explanation', () => {
      renderWithQuery('/add');

      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-disabled', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByText('Already enabled')).toBeInTheDocument();
    });

    it('marks the highlighted enabled row so navigation stays legible', () => {
      renderWithQuery('/add', {
        skills: [
          { id: 'e1', alias: 'assistant', path: '/a.md', enabled: true },
          { id: 'e2', alias: 'legacy', path: '/d.md', enabled: true },
        ],
      });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      // Nothing is addable, so the picker opens with no selection; the first
      // ArrowDown lands on the first enabled row.
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });

      const options = screen.getAllByRole('option');
      expect(options[0].className).toContain('bg-surface-elevated/40');
      expect(options[1].className).not.toContain('bg-surface-elevated/40');
      // Still inert — the marker is feedback only.
      expect(options[0]).toHaveAttribute('aria-disabled', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
    });

    it('clicking an enabled skill row does not add it', () => {
      const onSkillAdd = vi.fn();
      renderWithQuery('/add', { onSkillAdd });

      fireEvent.mouseDown(screen.getByText('assistant'));

      expect(onSkillAdd).not.toHaveBeenCalled();
    });

    it('Enter keeps any text typed before /add', () => {
      const onSkillAdd = vi.fn();
      const { setQuery } = renderWithQuery('hello /add', { onSkillAdd });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(onSkillAdd).toHaveBeenCalledWith('translate');
      expect(setQuery).toHaveBeenCalledWith('hello');
    });

    it('Ctrl+Enter adds the skill and stays in the picker', () => {
      const onSkillAdd = vi.fn();
      const { setQuery } = renderWithQuery('/add', { onSkillAdd });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

      expect(onSkillAdd).toHaveBeenCalledWith('translate');
      expect(setQuery).not.toHaveBeenCalled();
      expect(
        screen.getByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeInTheDocument();
    });

    it('Cmd+Enter also stays in the picker', () => {
      const onSkillAdd = vi.fn();
      const { setQuery } = renderWithQuery('/add', { onSkillAdd });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

      expect(onSkillAdd).toHaveBeenCalledWith('translate');
      expect(setQuery).not.toHaveBeenCalled();
    });

    it('Enter does nothing when no skills are configured', () => {
      const onSkillAdd = vi.fn();
      renderWithQuery('/add', { skills: [], onSkillAdd });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(onSkillAdd).not.toHaveBeenCalled();
    });

    it('clicking a skill row adds it and clears the /add word', () => {
      const onSkillAdd = vi.fn();
      const { setQuery } = renderWithQuery('/add', { onSkillAdd });

      fireEvent.mouseDown(screen.getByText('translate'));

      expect(onSkillAdd).toHaveBeenCalledWith('translate');
      expect(setQuery).toHaveBeenCalledWith('');
    });

    it('Escape dismisses the picker without changing the query', () => {
      const { setQuery } = renderWithQuery('/add');

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'Escape' });

      expect(setQuery).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('listbox', { name: 'Skill suggestions' }),
      ).toBeNull();
    });

    it('leaves other keys alone while the picker is open', () => {
      const onSkillAdd = vi.fn();
      const { setQuery } = renderWithQuery('/add', { onSkillAdd });

      const textarea = screen.getByPlaceholderText(
        'Ask a question, or type / to see commands',
      );
      fireEvent.keyDown(textarea, { key: 'a' });

      expect(onSkillAdd).not.toHaveBeenCalled();
      expect(setQuery).not.toHaveBeenCalled();
    });
  });

  describe('skill chips', () => {
    function renderChips(
      selectedSkills: string[],
      onSkillRemove?: (alias: string) => void,
    ) {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          skills={[]}
          selectedSkills={selectedSkills}
          onSkillAdd={vi.fn()}
          onSkillRemove={onSkillRemove}
        />,
      );
    }

    it('renders a chip per selected skill', () => {
      renderChips(['translate'], vi.fn());
      expect(
        screen.getByRole('list', { name: 'Selected skills' }),
      ).toBeInTheDocument();
      expect(screen.getByText('translate')).toBeInTheDocument();
    });

    it('renders nothing when no skills are selected', () => {
      renderChips([], vi.fn());
      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
    });

    it('renders nothing when no remove handler is provided', () => {
      renderChips(['translate']);
      expect(
        screen.queryByRole('list', { name: 'Selected skills' }),
      ).toBeNull();
    });

    it('calls onSkillRemove when the chip remove button is clicked', () => {
      const onSkillRemove = vi.fn();
      renderChips(['translate'], onSkillRemove);
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove skill translate' }),
      );
      expect(onSkillRemove).toHaveBeenCalledWith('translate');
    });
  });

  describe('input surface (item 18)', () => {
    it('wraps the textarea in the themed input shell', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const shell = container.querySelector('.ask-input-shell');
      expect(shell).not.toBeNull();
      expect(shell!.querySelector('textarea')).not.toBeNull();
      // The mirror must sit inside the same shell so the highlight overlay
      // stays aligned with the textarea's padding.
      expect(shell!.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    it('uses the placeholder token for the input placeholder', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = container.querySelector('textarea')!;
      expect(
        textarea.classList.contains('placeholder:text-text-placeholder'),
      ).toBe(true);
      // A visible caret on summon, independent of the transparent text.
      expect(textarea.style.caretColor).toBe('var(--color-text-primary)');
    });
  });
});
