/**
 * Mock for @tauri-apps/plugin-notification.
 *
 * The toast itself is a no-op in tests; `onAction` is a real vi.fn so tests can
 * both register the click handler and force the "unsupported" failure path.
 */

import { vi } from 'vitest';

type ActionHandler = () => void;

const actionHandlers = new Set<ActionHandler>();

export async function isPermissionGranted(): Promise<boolean> {
  return false;
}

export async function requestPermission(): Promise<string> {
  return 'denied';
}

export function sendNotification(): void {
  // no-op in tests
}

export const onAction = vi.fn(
  async (
    handler: ActionHandler,
  ): Promise<{ unregister: () => Promise<void> }> => {
    actionHandlers.add(handler);
    return {
      unregister: async () => {
        actionHandlers.delete(handler);
      },
    };
  },
);

/** Test helper: simulate the user clicking a desktop notification. */
export function emitNotificationAction() {
  for (const handler of actionHandlers) handler();
}

/** Test helper: drop every registered notification click handler. */
export function clearNotificationActionHandlers() {
  actionHandlers.clear();
}
