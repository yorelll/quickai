/**
 * Removes leading blank lines from text that is about to be copied.
 *
 * Providers stream the answer as raw text, and some begin it with the
 * newline(s) that separated their reasoning from the answer. Markdown
 * rendering ignores leading blank lines, so the reply looks right on screen,
 * but the copy button writes the raw text — and the paste starts with an
 * empty line.
 *
 * Only whole leading blank lines are removed: their line endings and any
 * spaces or tabs sitting on them. The first line that carries content is
 * returned untouched, so an indented code block keeps its indentation, and
 * nothing from the first content character onwards changes — internal blank
 * lines, code fences, lists and trailing whitespace all survive.
 */
export function trimLeadingBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, '');
}
