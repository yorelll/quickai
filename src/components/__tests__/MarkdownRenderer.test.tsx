/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownRenderer } from '../MarkdownRenderer';

/**
 * The shipped stylesheet, read off disk so the theme-mapping tests below run
 * against the real rules rather than a copy.
 */
const APP_CSS = readFileSync(
  resolve(import.meta.dirname, '../../App.css'),
  'utf8',
);

describe('MarkdownRenderer', () => {
  describe('Basic rendering', () => {
    it('renders plain text as paragraph', () => {
      const { container } = render(<MarkdownRenderer content="Hello world" />);
      expect(container.querySelector('p')).not.toBeNull();
      expect(container.textContent).toContain('Hello world');
    });

    it('renders h1 heading with correct element', () => {
      const { container } = render(
        <MarkdownRenderer content="# Heading One" />,
      );
      expect(container.querySelector('h1')).not.toBeNull();
      expect(container.querySelector('h1')!.textContent).toContain(
        'Heading One',
      );
    });

    it('renders bullet lists', () => {
      const { container } = render(
        <MarkdownRenderer content={'- item one\n- item two\n- item three'} />,
      );
      expect(container.querySelector('ul')).not.toBeNull();
      const items = container.querySelectorAll('li');
      expect(items).toHaveLength(3);
      expect(items[0].textContent).toContain('item one');
    });

    it('renders numbered lists', () => {
      const { container } = render(
        <MarkdownRenderer content={'1. first\n2. second\n3. third'} />,
      );
      expect(container.querySelector('ol')).not.toBeNull();
      const items = container.querySelectorAll('li');
      expect(items).toHaveLength(3);
      expect(items[1].textContent).toContain('second');
    });

    it('renders inline code', () => {
      const { container } = render(
        <MarkdownRenderer content="Use `console.log()` for debugging" />,
      );
      expect(container.querySelector('code')).not.toBeNull();
      expect(container.querySelector('code')!.textContent).toBe(
        'console.log()',
      );
    });

    it('renders fenced code blocks', () => {
      const { container } = render(
        <MarkdownRenderer content={'```js\nconst x = 1;\n```'} />,
      );
      expect(container.querySelector('pre')).not.toBeNull();
      expect(container.querySelector('pre code')).not.toBeNull();
      expect(container.querySelector('pre code')!.textContent).toContain(
        'const x = 1;',
      );
    });

    it('renders links with correct href', () => {
      const { container } = render(
        <MarkdownRenderer content="[Visit site](https://example.com)" />,
      );
      const link = container.querySelector('a[data-streamdown="link"]');
      expect(link).not.toBeNull();
      expect(link!.getAttribute('href')).toBe('https://example.com/');
      expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link!.getAttribute('target')).toBe('_blank');
      expect(link!.textContent).toBe('Visit site');
    });

    it('renders bold text', () => {
      const { container } = render(
        <MarkdownRenderer content="This is **bold** text" />,
      );
      // Streamdown renders bold as span with data-streamdown="strong"
      const bold = container.querySelector('[data-streamdown="strong"]');
      expect(bold).not.toBeNull();
      expect(bold!.textContent).toBe('bold');
    });

    it('renders italic text', () => {
      const { container } = render(
        <MarkdownRenderer content="This is *italic* text" />,
      );
      expect(container.querySelector('em')).not.toBeNull();
      expect(container.querySelector('em')!.textContent).toBe('italic');
    });

    it('applies custom className', () => {
      const { container } = render(
        <MarkdownRenderer content="text" className="custom-class" />,
      );
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.classList.contains('custom-class')).toBe(true);
    });

    it('applies markdown-body class by default', () => {
      const { container } = render(<MarkdownRenderer content="text" />);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.classList.contains('markdown-body')).toBe(true);
    });
  });

  describe('GFM support', () => {
    it('renders strikethrough text', () => {
      const { container } = render(
        <MarkdownRenderer content="This is ~~deleted~~ text" />,
      );
      expect(container.querySelector('del')).not.toBeNull();
      expect(container.querySelector('del')!.textContent).toBe('deleted');
    });

    it('renders tables', () => {
      const { container } = render(
        <MarkdownRenderer content={'| A | B |\n|---|---|\n| 1 | 2 |'} />,
      );
      expect(container.querySelector('table')).not.toBeNull();
      expect(container.querySelectorAll('th')).toHaveLength(2);
      expect(container.querySelectorAll('td')).toHaveLength(2);
    });

    it('renders task lists', () => {
      const { container } = render(
        <MarkdownRenderer content={'- [x] done\n- [ ] todo'} />,
      );
      const inputs = container.querySelectorAll('input[type="checkbox"]');
      expect(inputs).toHaveLength(2);
    });
  });

  describe('XSS prevention', () => {
    it('strips raw script tags from markdown source', () => {
      const { container } = render(
        <MarkdownRenderer content={'<script>alert("xss")</script>safe text'} />,
      );
      expect(container.querySelector('script')).toBeNull();
      expect(container.innerHTML).not.toContain('<script');
    });

    it('strips raw iframe embeds from markdown source', () => {
      const { container } = render(
        <MarkdownRenderer
          content={'<iframe src="https://evil.com"></iframe>'}
        />,
      );
      expect(container.querySelector('iframe')).toBeNull();
      expect(container.innerHTML).not.toContain('<iframe');
    });

    it('escapes raw img tags with event handlers to inert text', () => {
      const { container } = render(
        <MarkdownRenderer content={'<img src="x" onerror="alert(1)" />'} />,
      );
      // react-markdown escapes raw HTML to text — no actual <img> element is created
      expect(container.querySelector('img')).toBeNull();
    });

    it('sanitizes javascript: protocol in markdown links', () => {
      const { container } = render(
        <MarkdownRenderer content={'[click me](javascript:alert(1))'} />,
      );
      expect(container.innerHTML).not.toMatch(/javascript:/i);
    });

    it('renders safe markdown elements normally', () => {
      const { container } = render(
        <MarkdownRenderer content="**bold** and *italic* and `code`" />,
      );
      expect(
        container.querySelector('[data-streamdown="strong"]'),
      ).not.toBeNull();
      expect(container.querySelector('em')).not.toBeNull();
      expect(container.querySelector('code')).not.toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('handles empty string', () => {
      const { container } = render(<MarkdownRenderer content="" />);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('');
    });

    it('skips re-render when props are unchanged (React.memo)', () => {
      const { container, rerender } = render(
        <MarkdownRenderer content="stable" />,
      );
      const firstOutput = container.innerHTML;
      rerender(<MarkdownRenderer content="stable" />);
      expect(container.innerHTML).toBe(firstOutput);
    });
  });

  describe('Syntax highlighting (item 15)', () => {
    /** Waits for shiki's lazily-loaded highlighter to paint the token spans. */
    async function renderHighlighted(container: HTMLElement) {
      await waitFor(
        () => {
          const styled = tokenSpans(container).filter((s) =>
            s.getAttribute('style')?.includes('--shiki-dark'),
          );
          expect(styled.length).toBeGreaterThan(0);
        },
        { timeout: 10_000 },
      );
      return tokenSpans(container);
    }

    function tokenSpans(container: HTMLElement): HTMLElement[] {
      return [
        ...container.querySelectorAll<HTMLElement>(
          "[data-streamdown='code-block-body'] code span span",
        ),
      ];
    }

    it('paints real token colours instead of collapsing to inherit', async () => {
      const { container } = render(
        <MarkdownRenderer content={'```ts\n// a comment\nconst x = 1;\n```'} />,
      );
      const spans = await renderHighlighted(container);
      const comment = spans.find(
        (s) => s.textContent === '// a comment',
      ) as HTMLElement;

      // End-to-end: the plugin really resolved through Streamdown into the DOM.
      expect(comment).toBeDefined();
      expect(comment.getAttribute('style')).toContain('--sdm-c: #66707B');
      expect(comment.getAttribute('style')).toContain('--shiki-dark: #8B949E');
    });

    it('carries both palettes so a theme switch needs no re-highlight', async () => {
      const { container } = render(
        <MarkdownRenderer content={'```ts\nconst x = 1;\n```'} />,
      );
      const spans = await renderHighlighted(container);
      for (const span of spans) {
        const style = span.getAttribute('style') ?? '';
        expect(style).toContain('--sdm-c:');
        expect(style).toContain('--shiki-dark:');
      }
    });
  });

  describe('App.css theme mapping (item 19)', () => {
    /**
     * jsdom applies the cascade but does not evaluate `var()`, so
     * `getComputedStyle` returns the winning declaration's literal text. That
     * is exactly what needs guarding: the two rules are the whole theme swap,
     * and a dark↔light inversion would be silent.
     */
    const BASE_SELECTOR = "[data-streamdown='code-block-body'] code span span";
    const LIGHT_SELECTOR = `:root[data-theme='light'] ${BASE_SELECTOR}`;

    function ruleText(selector: string): string {
      const at = APP_CSS.indexOf(`\n${selector} {`);
      expect(at).toBeGreaterThan(-1);
      const open = APP_CSS.indexOf('{', at);
      const close = APP_CSS.indexOf('}', open);
      return `${selector} ${APP_CSS.slice(open, close + 1)}`;
    }

    let styleEl: HTMLStyleElement;

    beforeEach(() => {
      styleEl = document.createElement('style');
      styleEl.textContent = `${ruleText(BASE_SELECTOR)}\n${ruleText(LIGHT_SELECTOR)}`;
      document.head.appendChild(styleEl);
    });

    afterEach(() => {
      styleEl.remove();
      delete document.documentElement.dataset.theme;
    });

    async function mappedColour(theme: 'light' | 'dark') {
      const { container } = render(
        <MarkdownRenderer content={'```ts\nconst x = 1;\n```'} />,
      );
      await waitFor(
        () => {
          expect(
            container.querySelector(
              "[data-streamdown='code-block-body'] code span span[style*='--shiki-dark']",
            ),
          ).not.toBeNull();
        },
        { timeout: 10_000 },
      );
      document.documentElement.dataset.theme = theme;
      const span = container.querySelector<HTMLElement>(
        "[data-streamdown='code-block-body'] code span span[style*='--shiki-dark']",
      )!;
      return getComputedStyle(span).color;
    }

    it('resolves dark through --shiki-dark', async () => {
      expect(await mappedColour('dark')).toContain('--shiki-dark');
    });

    it('resolves light through --sdm-c', async () => {
      const colour = await mappedColour('light');
      expect(colour).toContain('--sdm-c');
      expect(colour).not.toContain('--shiki-dark');
    });
  });
});
