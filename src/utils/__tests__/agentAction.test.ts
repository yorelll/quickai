import { describe, it, expect } from 'vitest';
import { formatAgentAction } from '../agentAction';
import { translate, type Translate } from '../../i18n';

const en: Translate = (key, params) => translate('en', key, params);
const zh: Translate = (key, params) => translate('zh', key, params);

describe('formatAgentAction', () => {
  it('localizes coordinate actions', () => {
    expect(formatAgentAction({ type: 'click', x: 100, y: 200 }, en)).toBe(
      'Click (100, 200)',
    );
    expect(formatAgentAction({ type: 'double_click', x: 1, y: 2 }, en)).toBe(
      'Double-click (1, 2)',
    );
    expect(formatAgentAction({ type: 'right_click', x: 1, y: 2 }, en)).toBe(
      'Right-click (1, 2)',
    );
    expect(
      formatAgentAction({ type: 'drag', x1: 1, y1: 2, x2: 3, y2: 4 }, en),
    ).toBe('Drag (1, 2) → (3, 4)');
  });

  it('localizes text, key and launch actions', () => {
    expect(formatAgentAction({ type: 'type', text: 'hello' }, en)).toBe(
      'Type "hello"',
    );
    expect(formatAgentAction({ type: 'key_press', combo: 'ctrl+c' }, en)).toBe(
      'Press ctrl+c',
    );
    expect(formatAgentAction({ type: 'launch', app: 'notepad' }, en)).toBe(
      'Open notepad',
    );
    expect(formatAgentAction({ type: 'done' }, en)).toBe('Finish');
  });

  it('localizes both scroll directions', () => {
    expect(
      formatAgentAction({ type: 'scroll', direction: 'up', amount: 3 }, en),
    ).toBe('Scroll up by 3');
    expect(
      formatAgentAction({ type: 'scroll', direction: 'down', amount: 3 }, en),
    ).toBe('Scroll down by 3');
  });

  it('passes an unknown scroll direction through verbatim', () => {
    expect(
      formatAgentAction({ type: 'scroll', direction: 'left', amount: 3 }, en),
    ).toBe('Scroll left by 3');
  });

  it('renders Simplified Chinese copy', () => {
    expect(formatAgentAction({ type: 'click', x: 100, y: 200 }, zh)).toBe(
      '点击 (100, 200)',
    );
    expect(
      formatAgentAction({ type: 'scroll', direction: 'up', amount: 3 }, zh),
    ).toBe('向上滚动 3');
    expect(formatAgentAction({ type: 'launch', app: 'notepad' }, zh)).toBe(
      '打开 notepad',
    );
    expect(formatAgentAction({ type: 'done' }, zh)).toBe('完成');
  });
});
