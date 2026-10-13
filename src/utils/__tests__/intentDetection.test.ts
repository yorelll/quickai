import { describe, it, expect } from 'vitest';
import { detectComputerUseIntent } from '../intentDetection';

describe('detectComputerUseIntent', () => {
  it('returns null for empty string', () => {
    expect(detectComputerUseIntent('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(detectComputerUseIntent('   ')).toBeNull();
  });

  it('returns null for normal chat', () => {
    expect(detectComputerUseIntent('Hello, how are you?')).toBeNull();
    expect(detectComputerUseIntent('What is 2+2?')).toBeNull();
    expect(detectComputerUseIntent('Explain quantum computing')).toBeNull();
  });

  // ─── Vision intent — English ─────────────────────────────────────────────
  it.each([
    'Take a screenshot of this',
    'What do you see?',
    "What's on the screen?",
    'Look at my screen',
    'Show me what you see',
    'Describe the screen',
    'What is on my screen',
    'Read the screen',
    'Analyze the screen content',
    'What can you see?',
  ])('detects English vision intent: %s', (message) => {
    expect(detectComputerUseIntent(message)).toBe('vision');
  });

  // ─── Vision intent — Chinese ─────────────────────────────────────────────
  it.each([
    '屏幕上有什么',
    '看图说话',
    '这张图是什么',
    '帮我识别图片',
    '帮我截图',
    '图片里有什么',
  ])('detects Chinese vision intent: %s', (message) => {
    expect(detectComputerUseIntent(message)).toBe('vision');
  });

  // ─── Agent intent — English ──────────────────────────────────────────────
  it.each([
    'Open notepad for me',
    'Open the calculator',
    'Click on the button',
    'Press the button to continue',
    'Type in the search box',
    'Launch chrome',
    'Start the app',
    'open chrome',
  ])('detects English agent intent: %s', (message) => {
    expect(detectComputerUseIntent(message)).toBe('agent');
  });

  // ─── Agent intent — Chinese ──────────────────────────────────────────────
  it.each([
    '打开记事本',
    '帮我操作一下',
    '点击确定按钮',
    '启动浏览器',
    '帮我做个表格',
  ])('detects Chinese agent intent: %s', (message) => {
    expect(detectComputerUseIntent(message)).toBe('agent');
  });

  it('detects the explicit /do command', () => {
    expect(detectComputerUseIntent('/do open notepad')).toBe('agent');
  });

  it('agent intent overrides vision when both match', () => {
    expect(detectComputerUseIntent('打开这个页面的截图')).toBe('agent');
  });

  // ─── False positives — should be null ────────────────────────────────────
  it('does not match "see" alone as vision', () => {
    expect(detectComputerUseIntent('I see what you mean')).toBeNull();
  });

  it('does not match "screen" alone without intent', () => {
    expect(
      detectComputerUseIntent('The screen resolution is 1920x1080'),
    ).toBeNull();
  });

  it('does not match unrelated "type" usage', () => {
    expect(
      detectComputerUseIntent('What type of music do you like?'),
    ).toBeNull();
    expect(detectComputerUseIntent('I like this type of book')).toBeNull();
  });
});
