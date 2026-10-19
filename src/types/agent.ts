/**
 * Wire types for the cloud agent loop (`/do`).
 *
 * Mirrors the Rust `AgentEvent` / `AgentAction` enums in `src-tauri/src/agent.rs`
 * (see `task/INTERFACE.md`). The backend never sends English UI prose: it ships
 * a structured `AgentAction` the frontend localizes, and model-produced text
 * (`text`, `result`, `summary`) that is shown verbatim.
 */

import type { ApiError } from './chat';

/** A desktop action in its wire form. `type` is the serde tag. */
export type AgentAction =
  | { type: 'click'; x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'right_click'; x: number; y: number }
  | { type: 'drag'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'type'; text: string }
  | { type: 'key_press'; combo: string }
  | { type: 'scroll'; direction: string; amount: number }
  | { type: 'launch'; app: string }
  | { type: 'list_dir'; path: string }
  | { type: 'done' };

/**
 * A non-fatal agent diagnostic, carried separately from the terminal `error`
 * event. The backend reuses the `ApiError` codes; `skill_unreadable` means one
 * selected skill's file could not be read and was left out of the prompt. The
 * run continues, so a notice never ends the run or hides the agent panel.
 */
export type AgentNotice = ApiError;

/**
 * An event emitted by the agent loop. `kind` is the serde tag.
 *
 * There is no non-fatal chunk variant: a recoverable problem arrives as an
 * `error` event whose `code` the consumer classifies (see `AgentNotice`).
 */
export type AgentEvent =
  | { kind: 'reasoning'; text: string }
  | { kind: 'action_executed'; action: AgentAction; result: string }
  | { kind: 'confirmation_required'; action: AgentAction }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'done'; summary: string };
