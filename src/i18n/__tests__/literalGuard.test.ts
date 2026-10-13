import { describe, it, expect } from 'vitest';
import ts from 'typescript';

/**
 * Guard (R1): no user-visible literal may bypass the dictionary.
 *
 * Parses every non-test `.tsx` source with the TypeScript compiler and asserts
 * that (a) `aria-label` / `placeholder` / `title` / `alt` never carry a string
 * literal, and (b) every JSX text node is either intentionally language-neutral
 * or absent. Stray punctuation (e.g. a hardcoded closing paren next to a
 * translated phrase) is rejected too.
 */

const SOURCES = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** JSX text tokens that are deliberately not localized. */
const ALLOWED_JSX_TEXT = new Set([
  // Physical key names are language-neutral on the key caps themselves.
  'Ctrl',
  // Version-number prefix ("v0.1.0").
  'v',
  // Config file name rendered inside <code>.
  'config.toml',
]);

/** True when the JSX text carries no translatable prose. */
function isLanguageNeutral(text: string): boolean {
  if (ALLOWED_JSX_TEXT.has(text)) return true;
  // Slash-command triggers (e.g. "/screen") are wire identifiers.
  if (/^\/\S+$/.test(text)) return true;
  // Character entities are punctuation, not prose.
  const prose = text.replace(/&[a-zA-Z]+;|&#\d+;/g, '');
  return !/\p{L}/u.test(prose);
}

const TRANSLATABLE_ATTRIBUTES = new Set([
  'aria-label',
  'placeholder',
  'title',
  'alt',
]);

function isSourceFile(path: string): boolean {
  return !path.includes('/__tests__/') && !path.includes('/testUtils/');
}

interface Offence {
  kind: 'attribute' | 'text';
  file: string;
  detail: string;
}

function scan(file: string, source: string): Offence[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const offences: Offence[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf).trim();
      if (text.length > 0) {
        if (!isLanguageNeutral(text)) {
          offences.push({
            kind: 'text',
            file,
            detail: `JSX text ${JSON.stringify(text)}`,
          });
        } else if (/[()]/.test(text)) {
          offences.push({
            kind: 'text',
            file,
            detail: `stray punctuation in JSX text ${JSON.stringify(text)}`,
          });
        }
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      TRANSLATABLE_ATTRIBUTES.has(node.name.getText(sf)) &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer)
    ) {
      offences.push({
        kind: 'attribute',
        file,
        detail: `${node.name.getText(sf)}="${node.initializer.text}"`,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return offences;
}

const FILES = Object.entries(SOURCES).filter(([path]) => isSourceFile(path));
const OFFENCES = FILES.flatMap(([path, source]) => scan(path, source));

describe('no user-facing literal escapes the dictionary', () => {
  it('finds source files to scan', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it('uses dictionary lookups for every translatable attribute', () => {
    expect(OFFENCES.filter((o) => o.kind === 'attribute')).toEqual([]);
  });

  it('has no untranslated JSX text', () => {
    expect(OFFENCES.filter((o) => o.kind === 'text')).toEqual([]);
  });
});
