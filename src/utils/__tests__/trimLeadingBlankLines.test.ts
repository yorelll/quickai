import { describe, it, expect } from 'vitest';
import { trimLeadingBlankLines } from '../trimLeadingBlankLines';

describe('trimLeadingBlankLines', () => {
  it('returns text without leading blank lines unchanged', () => {
    expect(trimLeadingBlankLines('Hello world')).toBe('Hello world');
  });

  it('removes a single leading newline', () => {
    expect(trimLeadingBlankLines('\nHello')).toBe('Hello');
  });

  it('removes multiple leading newlines', () => {
    expect(trimLeadingBlankLines('\n\n\nHello')).toBe('Hello');
  });

  it('removes CRLF line endings', () => {
    expect(trimLeadingBlankLines('\r\n\r\nHello')).toBe('Hello');
  });

  it('removes a lone carriage return line ending', () => {
    expect(trimLeadingBlankLines('\rHello')).toBe('Hello');
  });

  it('removes spaces and tabs that occupy a leading blank line', () => {
    expect(trimLeadingBlankLines('  \t\n \nHello')).toBe('Hello');
  });

  it('keeps the indentation of a leading indented code block', () => {
    expect(trimLeadingBlankLines('    const x = 1;')).toBe('    const x = 1;');
  });

  it('keeps indentation after removing the blank line above it', () => {
    expect(trimLeadingBlankLines('\n\n    const x = 1;')).toBe(
      '    const x = 1;',
    );
  });

  it('keeps a tab-indented first line', () => {
    expect(trimLeadingBlankLines('\n\tindented')).toBe('\tindented');
  });

  it('preserves internal blank lines, code fences and lists', () => {
    const text = '\n\n# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n';
    expect(trimLeadingBlankLines(text)).toBe(
      '# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n',
    );
  });

  it('preserves trailing whitespace', () => {
    expect(trimLeadingBlankLines('\n\nend  \n')).toBe('end  \n');
  });

  it('returns an empty string for input that is only blank lines', () => {
    expect(trimLeadingBlankLines('\n \n\r\n')).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(trimLeadingBlankLines('')).toBe('');
  });
});
