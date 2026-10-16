/**
 * A user-configurable skill, mirroring the backend `Skill` struct.
 *
 * `path` points at a file whose contents are the skill text. Skills with
 * `enabled: true` are appended to the system prompt on every turn; any skill
 * can be invoked for a single turn by naming its `alias` with `/add`.
 */
export interface Skill {
  /** Stable opaque id assigned by the backend. */
  id: string;
  /** Unique, whitespace-free display name used to invoke the skill. */
  alias: string;
  /** Absolute path to the file holding the skill text. */
  path: string;
  /** Whether the skill is appended to the system prompt on every turn. */
  enabled: boolean;
}
