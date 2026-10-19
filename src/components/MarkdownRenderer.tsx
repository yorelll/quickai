import React, { memo } from 'react';
import { Streamdown } from 'streamdown';
import { createCodePlugin } from '@streamdown/code';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Whether this content is actively being streamed from the LLM. */
  isStreaming?: boolean;
}

/**
 * Syntax-highlighting themes, `[light, dark]`.
 *
 * Chosen by measurement against this app's own code surface, because the two
 * things that were broken — comments vanishing into the background and body
 * text inheriting the window colour — are both contrast problems. Every token
 * type clears WCAG AA (4.5:1) in both themes:
 *
 * | token                       | light on `#ffffff`    | dark on `#12121a`     |
 * |-----------------------------|-----------------------|-----------------------|
 * | comment                     | `#66707B`  5.04:1     | `#8B949E`  6.06:1     |
 * | keyword (`import`, `class`) | `#A0111F`  8.09:1     | `#FF7B72`  7.39:1     |
 * | function / type name        | `#622CBC`  8.06:1     | `#D2A8FF`  9.57:1     |
 * | variable / parameter        | `#702C00` 10.25:1     | `#FFA657`  9.62:1     |
 * | string / number             | `#023B95` 10.18:1     | `#79C0FF`  9.58:1     |
 * | body text                   | `#0E1116` 18.91:1     | `#E6EDF3` 15.77:1     |
 *
 * The stock defaults do not hold up. `github-dark`'s comment measures 3.87:1
 * and `github-light`'s 4.28:1 on our backgrounds — precisely the faint-comment
 * complaint. `slack-ochin`, which this started on, is worse than it looks: its
 * comment clears AA but its function names land at 2.25:1, type keywords at
 * 3.25:1 and variables at 3.42:1. Of the 21 bundled light themes,
 * `github-light-high-contrast` is the only one that gets every *hue* over AA;
 * its last straggler was the comment at 4.48:1 against a `#f4f1ee` block, and
 * lifting the light `--color-code-bg` to `#ffffff` carries it to 5.04:1. That
 * also *raises* the block's separation from the `#f6f4f1` window (1.025:1 →
 * 1.098:1), so nothing was traded away.
 *
 * `github-light-high-contrast` / `github-dark-default` are one family, and
 * their body text sits within a few units of `--color-code-text`
 * (`#1f1c1a` / `#e6e6e9`), so the block does not visibly recolour when the
 * highlighter resolves after first paint.
 *
 * Both themes are handed to the highlighter in one pass (shiki emits the light
 * colour as `color` and the dark one as `--shiki-dark`), so switching theme is
 * a pure CSS swap — see the token rules in App.css. Nothing has to re-render
 * or re-highlight.
 */
export const CODE_THEMES = [
  'github-light-high-contrast',
  'github-dark-default',
] as const;

/**
 * The code-highlighter plugin handed to Streamdown.
 *
 * Without a plugin Streamdown has no highlighter at all: it renders every
 * token with `color: inherit`, which is what made code in light theme
 * near-black on a near-black block. `plugins.code` is also what Streamdown
 * reads its themes from — `getThemes()` takes precedence over the
 * `shikiTheme` prop — so this is the single place the palette is defined.
 *
 * Created once at module scope: `createCodePlugin` only stores the theme
 * names, the (async) highlighter itself is built lazily on first highlight.
 */
export const codePlugin = createCodePlugin({
  themes: [CODE_THEMES[0], CODE_THEMES[1]],
});

/**
 * Renders markdown content using Streamdown, a streaming-aware markdown
 * renderer that handles incomplete syntax and memoizes completed blocks.
 *
 * During streaming, only the last in-progress block re-renders on each
 * token. Completed paragraphs are memoized and never reflow, eliminating
 * the bubble-height jitter caused by full markdown re-parsing.
 *
 * Security: Streamdown sanitizes rendered output via rehype-sanitize
 * (allowlist-based HTML element/attribute filtering) and rehype-harden
 * (blocks dangerous URL protocols). Raw HTML in markdown source is parsed
 * then sanitized, stripping script tags, event handlers, iframes, and
 * javascript: URLs. Link safety is disabled so links render as native
 * anchor elements with target="_blank" and rel="noopener noreferrer".
 *
 * Memoized to skip re-renders when props are unchanged, which matters
 * during LLM token streaming where sibling bubbles would otherwise
 * re-render on every new token.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(
  function MarkdownRenderer({ content, className = '', isStreaming = false }) {
    return (
      <span className={`markdown-body ${className}`}>
        <Streamdown
          mode={isStreaming ? 'streaming' : 'static'}
          /* Syntax highlighting. The plugin carries both palettes, so the
             theme swap happens in CSS (App.css) and never needs a re-render. */
          plugins={{ code: codePlugin }}
          /* Enable only the copy button on code blocks; disable download
             and all other block-level controls (table, mermaid). The parent
             ChatBubble provides its own CopyButton for the full message. */
          controls={{ code: { copy: true, download: false } }}
          /* Disable the link safety interstitial modal so links render as
             native <a> elements with href, target="_blank", and noopener.
             In a Tauri app the webview opens external links in the system
             browser, making the modal unnecessary friction. */
          linkSafety={{ enabled: false }}
        >
          {content}
        </Streamdown>
      </span>
    );
  },
);
