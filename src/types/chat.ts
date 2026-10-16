/**
 * Chat types shared across the overlay.
 *
 * `ApiError.code` is a stable key the frontend localizes; `message` carries
 * the raw provider detail for logs and for the error card's subtitle.
 */

/** Stable error keys emitted by the Rust `ApiError` struct. */
export type ApiErrorCode =
  | 'missing_api_key'
  | 'missing_model'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'model_not_found'
  | 'bad_request'
  | 'context_length_exceeded'
  | 'cancelled'
  | 'skill_unreadable'
  | 'unknown';

export interface ApiError {
  code: ApiErrorCode | string;
  message: string;
}

/** A single message in the chat thread. */
export interface Message {
  /** Unique identifier for stable React list keys. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Selected text from the host app that was quoted with this message. */
  quotedText?: string;
  /** Absolute file paths of images attached to this message, if any. */
  imagePaths?: string[];
  /** Accumulated thinking/reasoning content, when thinking mode was used. */
  thinkingContent?: string;
  /** Present on assistant messages that represent a provider error callout. */
  error?: ApiError;
  /**
   * A non-fatal notice streamed during the turn (e.g. a selected skill whose
   * file could not be read). Unlike `error` it never replaces the answer: the
   * turn continues and the notice is shown alongside the content.
   */
  notice?: ApiError;
}

/** Streaming chunks emitted by the `ask` command over the Tauri channel. */
export type StreamChunk =
  | { type: 'Token'; data: string }
  | { type: 'ThinkingToken'; data: string }
  | { type: 'Error'; data: ApiError }
  | { type: 'Done' }
  | { type: 'Cancelled' };
