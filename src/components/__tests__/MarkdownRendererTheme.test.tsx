/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BundledLanguage } from 'shiki';

/**
 * Streamdown is mocked in this file only, so the props MarkdownRenderer hands
 * it (notably `plugins`) can be asserted directly. `MarkdownRenderer.test.tsx`
 * keeps the real renderer for DOM-level coverage.
 */
const captured = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock('streamdown', () => ({
  Streamdown: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return null;
  },
}));

import { MarkdownRenderer, CODE_THEMES, codePlugin } from '../MarkdownRenderer';

/**
 * The app's stylesheet, read straight off disk so these tests assert the theme
 * mapping against the CSS that actually ships. (Vite's `?raw` loader returns an
 * empty string for `.css` under Vitest's stubbed CSS pipeline.)
 */
const APP_CSS_TEXT = readFileSync(
  resolve(import.meta.dirname, '../../App.css'),
  'utf8',
);

/** The declaration body of the rule whose selector line is exactly `selector`. */
function ruleBody(selector: string): string | null {
  const at = APP_CSS_TEXT.indexOf(`\n${selector} {`);
  if (at === -1) return null;
  const open = APP_CSS_TEXT.indexOf('{', at);
  const close = APP_CSS_TEXT.indexOf('}', open);
  return APP_CSS_TEXT.slice(open + 1, close);
}

/** The value of a `--color-*` token declared inside the given block. */
function tokenValue(block: string, name: string): string | null {
  const m = block.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
  return m ? m[1].trim() : null;
}

const THEME_BLOCK = APP_CSS_TEXT.match(/@theme \{(.*?)\n\}/s)?.[1] ?? '';
const LIGHT_BLOCK =
  APP_CSS_TEXT.match(/:root\[data-theme='light'\] \{(.*?)\n\}/s)?.[1] ?? '';

const DARK_CODE_BG = tokenValue(THEME_BLOCK, '--color-code-bg');
const LIGHT_CODE_BG = tokenValue(LIGHT_BLOCK, '--color-code-bg');

// ─── contrast helpers (WCAG 2.1 relative luminance) ──────────────────────────

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * channel(parseInt(h.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(h.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(h.slice(4, 6), 16))
  );
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ─── real highlighting ───────────────────────────────────────────────────────

/** A sample that exercises comments, keywords, types, variables and literals. */
const SAMPLE = `import { useState } from 'react';
// a comment
interface Props { name: string; count: number; }
export function useCounter(initial: number): number {
  const [value, setValue] = useState(initial);
  class Widget { render() { return 42; } }
  let total = value + 1.5;
  return \`\${total}\`;
}
`;

interface ProbeToken {
  text: string;
  light: string;
  dark: string;
}

/**
 * Runs the real plugin. Shiki loads lazily: on a cold cache the first call
 * returns null and delivers tokens through the callback; once a highlighter
 * for the language+themes pair is cached the result comes back synchronously.
 * Both shapes are handled.
 */
async function highlightTokens(code: string): Promise<ProbeToken[]> {
  return await new Promise<ProbeToken[]>((resolve, reject) => {
    const flatten = (
      tokens: Array<{
        content: string;
        htmlStyle?: Record<string, string>;
      }>,
    ) =>
      tokens
        .filter((t) => t.content.trim() !== '')
        .map((t) => ({
          text: t.content.trim(),
          light: t.htmlStyle?.color ?? '',
          dark: t.htmlStyle?.['--shiki-dark'] ?? '',
        }));

    const timer = setTimeout(
      () => reject(new Error('highlight timed out')),
      20_000,
    );
    const immediate = codePlugin.highlight(
      {
        code,
        language: 'tsx',
        themes: codePlugin.getThemes(),
        isIncomplete: false,
      },
      (result) => {
        clearTimeout(timer);
        resolve(flatten(result.tokens.flat()));
      },
    );
    if (immediate) {
      clearTimeout(timer);
      resolve(flatten(immediate.tokens.flat()));
    }
  });
}

/** The colour a given source text was painted with, in one of the two modes. */
function colourOf(tokens: ProbeToken[], text: string, mode: 'light' | 'dark') {
  const hit = tokens.find((t) => t.text === text);
  if (!hit) throw new Error(`no token rendered for ${JSON.stringify(text)}`);
  return hit[mode];
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('code themes', () => {
  it('uses the measured pair, light first', () => {
    expect(CODE_THEMES).toEqual([
      'github-light-high-contrast',
      'github-dark-default',
    ]);
  });

  it('exposes the pair through the plugin, which is what Streamdown reads', () => {
    expect(codePlugin.getThemes()).toEqual([
      'github-light-high-contrast',
      'github-dark-default',
    ]);
    expect(codePlugin.name).toBe('shiki');
    expect(codePlugin.type).toBe('code-highlighter');
  });

  it('recognises supported languages and rejects unknown ones', () => {
    expect(codePlugin.supportsLanguage('c')).toBe(true);
    expect(codePlugin.supportsLanguage('typescript')).toBe(true);
    // `supportsLanguage` is typed against shiki's BundledLanguage union, but the
    // plugin's whole job is to tolerate whatever a model emits, so an unknown
    // language is cast in to prove it answers false rather than throwing.
    const unknown = 'definitely-not-a-language' as BundledLanguage;
    expect(codePlugin.supportsLanguage(unknown)).toBe(false);
    expect(codePlugin.getSupportedLanguages().length).toBeGreaterThan(0);
  });
});

describe('App.css code-theme mapping', () => {
  const BASE_SELECTOR = "[data-streamdown='code-block-body'] code span span";
  const LIGHT_SELECTOR = `:root[data-theme='light'] ${BASE_SELECTOR}`;

  it('reads the dark palette through --shiki-dark on the base rule', () => {
    const body = ruleBody(BASE_SELECTOR);
    expect(body).not.toBeNull();
    expect(body).toContain('color: var(--shiki-dark, var(--sdm-c, inherit))');
  });

  it('reads the light palette through --sdm-c under data-theme="light"', () => {
    const body = ruleBody(LIGHT_SELECTOR);
    expect(body).not.toBeNull();
    expect(body).toContain('color: var(--sdm-c, inherit)');
  });

  it('gives the light override higher specificity than the base rule', () => {
    // The swap is silent if these ever invert, so assert it rather than trust it.
    const specificity = (selector: string) => {
      const classes = (selector.match(/\[[^\]]+\]|:(?!:)[a-z-]+/g) ?? [])
        .length;
      return classes;
    };
    expect(specificity(LIGHT_SELECTOR)).toBeGreaterThan(
      specificity(BASE_SELECTOR),
    );
  });

  it('declares a code background for both themes', () => {
    expect(DARK_CODE_BG).toBe('#12121a');
    expect(LIGHT_CODE_BG).toBe('#ffffff');
  });
});

describe('syntax palette contrast against the shipped code background', () => {
  it('paints each token type with the documented colour', async () => {
    const tokens = await highlightTokens(SAMPLE);

    // Comments — the specific item-15 complaint.
    expect(colourOf(tokens, '// a comment', 'light')).toBe('#66707B');
    expect(colourOf(tokens, '// a comment', 'dark')).toBe('#8B949E');
    // Keywords, function names, variables and literals each get their own hue.
    expect(colourOf(tokens, 'interface', 'light')).toBe('#A0111F');
    expect(colourOf(tokens, 'interface', 'dark')).toBe('#FF7B72');
    expect(colourOf(tokens, 'useCounter', 'light')).toBe('#622CBC');
    expect(colourOf(tokens, 'useCounter', 'dark')).toBe('#D2A8FF');
    expect(colourOf(tokens, 'name', 'light')).toBe('#702C00');
    expect(colourOf(tokens, 'name', 'dark')).toBe('#FFA657');
    expect(colourOf(tokens, '42', 'light')).toBe('#023B95');
    expect(colourOf(tokens, '42', 'dark')).toBe('#79C0FF');
    // Punctuation / body text falls through to the theme foreground.
    expect(colourOf(tokens, '{', 'light')).toBe('#0E1116');
    expect(colourOf(tokens, '{', 'dark')).toBe('#E6EDF3');
  });

  it('keeps every emitted colour at or above AA in both themes', async () => {
    const tokens = await highlightTokens(SAMPLE);
    expect(DARK_CODE_BG).not.toBeNull();
    expect(LIGHT_CODE_BG).not.toBeNull();

    for (const [mode, bg] of [
      ['light', LIGHT_CODE_BG!],
      ['dark', DARK_CODE_BG!],
    ] as const) {
      const colours = [...new Set(tokens.map((t) => t[mode]).filter(Boolean))];
      expect(colours.length).toBeGreaterThan(4);
      const failing = colours
        .map((c) => ({ c, r: contrast(c, bg) }))
        .filter((x) => x.r < 4.5);
      expect(failing).toEqual([]);
    }
  });

  it('keeps the light comment clear of the 4.5:1 floor with margin', async () => {
    const tokens = await highlightTokens(SAMPLE);
    const comment = colourOf(tokens, '// a comment', 'light');
    // Measured 5.04:1 — this is the colour that forced the white code
    // background; a warmer block would drop it back under 4.5:1.
    expect(contrast(comment, LIGHT_CODE_BG!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('MarkdownRenderer plugin wiring', () => {
  beforeEach(() => {
    captured.props.length = 0;
  });

  function lastProps() {
    return captured.props[captured.props.length - 1];
  }

  it('hands the code plugin to Streamdown', () => {
    render(<MarkdownRenderer content="code" />);
    expect(lastProps().plugins).toEqual({ code: codePlugin });
  });

  it('keeps the code-block controls and link-safety settings', () => {
    render(<MarkdownRenderer content="code" />);
    expect(lastProps().controls).toEqual({
      code: { copy: true, download: false },
    });
    expect(lastProps().linkSafety).toEqual({ enabled: false });
  });

  it('does not need a theme prop — the plugin carries both palettes', () => {
    render(<MarkdownRenderer content="code" />);
    expect(lastProps().shikiTheme).toBeUndefined();
  });
});
