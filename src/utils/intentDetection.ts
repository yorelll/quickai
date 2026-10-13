/**
 * Intent detection for computer-use and vision queries.
 *
 * Analyzes user messages to determine if they're asking about screen content
 * or requesting a vision-based action. Patterns are kept in data tables so
 * adding a phrasing is a one-line change.
 *
 * Languages: English and Simplified Chinese.
 */

/** Screen/vision phrasings that should auto-capture a screenshot. */
const VISION_INTENT_PATTERNS: readonly RegExp[] = [
  // English — screen/vision queries
  /\bscreenshot/i,
  /\bwhat\s+(?:do\s+you\s+)?see\b/i,
  /\bwhat'?s?\s+on\s+(?:the\s+|my\s+)?screen\b/i,
  /\blook\s+at\s+(?:the\s+|my\s+)?screen\b/i,
  /\bshow\s+me\s+(?:what\s+you\s+)?see\b/i,
  /\bdescribe\s+(?:the\s+|my\s+)?screen\b/i,
  /\bwhat\s+(?:is|are)\s+on\s+(?:the\s+|my\s+)?screen\b/i,
  /\bread\s+(?:the\s+|my\s+)?screen\b/i,
  /\bscreen\s+content\b/i,
  /\bwhat\s+can\s+you\s+see\b/i,
  // Chinese — screen/vision queries
  /屏幕/,
  /看图/,
  /这张图/,
  /识别图片/,
  /截图/,
  /图片里/,
];

/** App names commonly used in desktop control commands. */
const APP_NAMES = [
  'notepad',
  'calculator',
  'paint',
  'chrome',
  'firefox',
  'word',
  'excel',
  'powerpoint',
  'explorer',
  'cmd',
  'terminal',
  'vscode',
  'discord',
  'spotify',
  'browser',
  'app',
  'program',
  'file',
  'the',
];

/**
 * Build a regex alternation from an array of strings.
 * Returns "(?:a|b|c)" pattern string.
 */
function alt(patterns: readonly string[]): string {
  return `(?:${patterns.join('|')})`;
}

/** Phrasings that indicate the user wants autonomous desktop control. */
const AGENT_INTENT_PATTERNS: readonly RegExp[] = [
  // English — action-oriented requests
  new RegExp(`\\bopen\\s+${alt(APP_NAMES)}`, 'i'),
  /\bclick\s+on\b/i,
  /\bpress\s+(?:the\s+)?(?:button|key)/i,
  /\btype\s+(?:in|into|the\s+\w+)\b/i,
  /\blaunch\s+\w/i,
  /\bstart\s+(?:the\s+)?(?:app|program)\b/i,
  // Chinese — action-oriented requests
  /打开/,
  /帮我操作/,
  /点击/,
  /启动/,
  /帮我做/,
  // /do command explicitly
  /\/do\b/,
];

/**
 * Classifies the user's intent from their message.
 *
 * - `'vision'` — the user wants to see/describe what's on screen
 *   (auto-capture screenshot, send to vision model for description)
 * - `'agent'` — the user wants autonomous desktop control
 *   (trigger full agent loop with /do behavior)
 * - `null` — no computer-use intent detected
 *   (normal chat query)
 */
export function detectComputerUseIntent(
  message: string,
): 'vision' | 'agent' | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) return null;

  // Agent intent takes priority — if they want actions, don't downgrade to vision.
  for (const pattern of AGENT_INTENT_PATTERNS) {
    if (pattern.test(trimmed)) return 'agent';
  }

  for (const pattern of VISION_INTENT_PATTERNS) {
    if (pattern.test(trimmed)) return 'vision';
  }

  return null;
}
