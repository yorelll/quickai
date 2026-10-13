import { vi } from 'vitest';

type FocusHandler = (event: { payload: boolean }) => void;

const focusHandlers = new Set<FocusHandler>();

const mockWindow = {
  setSize: vi.fn(async () => {}),
  setPosition: vi.fn(async () => {}),
  hide: vi.fn(async () => {}),
  show: vi.fn(async () => {}),
  setFocus: vi.fn(async () => {}),
  startDragging: vi.fn(async () => {}),
  minimize: vi.fn(async () => {}),
  onFocusChanged: vi.fn(async (handler: FocusHandler) => {
    focusHandlers.add(handler);
    return () => {
      focusHandlers.delete(handler);
    };
  }),
};

export function getCurrentWindow() {
  return mockWindow;
}

/** Test helper: simulate the window gaining or losing focus. */
export function emitFocusChanged(focused: boolean) {
  for (const handler of focusHandlers) handler({ payload: focused });
}

/** Test helper: drop every registered focus handler. */
export function clearFocusHandlers() {
  focusHandlers.clear();
}

export class LogicalSize {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

export class LogicalPosition {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export { mockWindow as __mockWindow };
