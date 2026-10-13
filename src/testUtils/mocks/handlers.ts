import type { RequestHandler } from 'msw';

/**
 * MSW request handlers.
 *
 * QuickAI talks to its cloud providers from the Rust side over IPC, so the
 * frontend makes no direct HTTP requests. The server is still installed so
 * tests fail loudly (`onUnhandledRequest: 'error'`) if any code introduces a
 * network call.
 */
export const handlers: RequestHandler[] = [];
