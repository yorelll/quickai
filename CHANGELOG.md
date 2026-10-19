# Changelog

All notable changes to QuickAI are documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the changelog follows the
[Conventional Commits](https://www.conventionalcommits.org/) grouping. Entries
are written by hand as part of the manual release process (see
[RELEASING.md](RELEASING.md)).

## 0.0.4 (2026-10-19)

An agent directory-listing tool, a provider connection test, and a batch of
Windows-shell, Settings, chat, and skills fixes.

### Features

* **Agent directory listing** — the `/do` agent can now enumerate a folder
  (names and a type indicator only, never file contents, capped at 200 entries)
  instead of guessing at paths. Under the `Limited` permission mode it always
  requires your approval — it is the one silent, headless read channel — while
  `Full` never asks.
* **Test connection** — the AI tab can now probe the configured provider and
  distinguish an unreachable address, an authentication failure, a model that
  does not exist, an unsupported capability, and a missing key or model. The
  default state reads "not yet tested".
* **Native file picker for skill paths** — a **Browse…** button on the skill
  path field.
* **Skill enablement hint** — a line explaining that enabled skills are appended
  to the system prompt every turn, while disabled ones are used only when named
  with `/add`.
* **Code-block syntax highlighting** — real highlighting that follows the
  light/dark theme.
* **Overlay input surface** — the input area now has its own surface and a focus
  ring, with the placeholder "Ask anything, or type / for commands".

### Changed

* **The agent discovers paths by listing a folder, not by being told them.** It
  is not sent any machine-specific path; when it needs to know what a directory
  holds, it lists it with `computer_list_dir` — a step you approve and can see.
  The trade-off: a task like "list every file on my desktop" may take one extra
  approval, because the agent must list a folder before it can learn the path.
* **The installer is about 10 MB larger.** The syntax-highlighting dependency
  bundles one lazy-loaded chunk per programming language; only the chunk for a
  language actually being highlighted is fetched at runtime (roughly +60 kB
  gzipped at first paint), but the installer grows by about 10 MB.
* **Skill paths are now validated** — only `.txt`, `.md`, and `.markdown` are
  accepted, a directory is rejected, and surrounding quotes (including curly
  quotes) are stripped so a pasted `"D:\…\test.md"` works. Rejection happens
  when you save.

### Fixed

* **Settings tab switching no longer lags** — tabs stay mounted after their first
  visit, so switching no longer re-reads settings over IPC (each revisit
  previously re-issued up to two IPC calls, one of which spawned a Task
  Scheduler process).
* **No more stray taskbar icon** — the real cause was `WS_EX_APPWINDOW`, which
  tao sets on every unowned window and which overrides `WS_EX_TOOLWINDOW`; the
  previous fix set only the latter.
* **The hotkey now opens on one double-tap** — two compounding causes: the
  hotkey decided on an internal flag rather than the window's real state, so the
  first double-tap dismissed an overlay you had not summoned; and a cooldown
  silently swallowed the first tap of a follow-up double-tap.
* **The chat input is no longer clipped while streaming** — the window was being
  sized from a measurement that included the entrance animation's scale
  transform.
* **Switching conversations lands at the bottom**, so a long conversation no
  longer stops at a code block in the middle.
* **`/add` now shows a newly added skill** — the list was stale because the
  return path from settings (via the mini bar) emitted no show event.
* **`/do` no longer pops the system "file not found" error dialog** when
  launching a program — launching now goes through `ShellExecuteW` directly
  instead of `cmd /c start`, which re-parsed the command line.
* **The agent confirmation now supports ←/→ to select and Enter to confirm**
  (allowing is selected by default), and the on-screen hint was updated to match.

## 0.0.3 (2026-10-15)

A theming and skills release, plus a batch of Settings, chat, and agent fixes.

### Features

* **Light theme** — a user-selectable theme on the General tab's **Appearance**
  section: `dark` (the default) or `light`. The light palette overrides the same
  design tokens, so switching applies immediately with no restart.
* **Skills** — a **Skills** section on the AI tab. Each entry has an **alias**
  (no spaces), a **path** to the file holding its text, and an
  **enabled-as-system-prompt** toggle; entries can be added, edited, deleted, and
  reordered (drag, or the up/down buttons). Exactly one built-in assistant skill
  is seeded on first use, lives in the config directory, and cannot be deleted.
* **`/add` command** — list and pick a skill from the chat bar. A bare `/add`
  opens the picker: <kbd>Enter</kbd> adds the highlighted skill and clears the
  box, while <kbd>Ctrl</kbd>+<kbd>Enter</kbd> adds it and stays in the picker for
  multi-select. Selected skills show as removable chips above the input and ride
  the message; typing `/add <alias>` directly invokes that skill.
* **Folder picker for the data directory** — the General tab's data-directory
  field now shows the full resolved default path as its hint and has a
  **Browse…** button that opens the native Windows folder picker.

### Changed

* **Hotkey wording** — the picker now reads "Double-tap <key>", making explicit
  that the summon gesture is a double-tap of the chosen key (<kbd>Alt</kbd> means
  <kbd>Alt</kbd>+<kbd>Alt</kbd>, not <kbd>Alt</kbd>+<kbd>Ctrl</kbd>).
* **About tab** — "Shortcuts and commands" and "Help" moved off the page into
  scrollable popup dialogs, so the first-level About page is no longer so tall.

### Fixed

* **Settings from an older version now save correctly.** A `config.toml` written
  before a section existed (for example a v0.0.1 file with no `[general]`) made
  every write to that section fail with `unknown section`, which is why the
  hotkey, language, and theme switches appeared to do nothing. The config writer
  now creates a missing allowed section instead of erroring.
* **Settings tab switching no longer lags** on General→AI and General→Display,
  and every tab shares one window height instead of shrinking the window and
  cutting off the lower settings.
* **Dragging the settings scrollbar no longer moves the window** — a mousedown on
  a scrollbar scrolls instead of starting a window drag.
* **Opening a history conversation lands at the input box**, and switching
  between conversations returns to the bottom of the transcript.
* **The chat input is no longer clipped while streaming** — the height budget now
  accounts for the reply box and the input bar together.
* **Keyboard control of agent confirmations works again** — while a confirmation
  is pending, <kbd>1</kbd> allows, <kbd>2</kbd> denies, and <kbd>Ctrl</kbd>+<kbd>C</kbd>
  aborts, even with the input box focused.
* **Light-theme contrast** — text and icons are legible on every surface in both
  themes.

## 0.0.2 (2026-10-14)

A usability release focused on configuration, the Settings window, and the chat
and agent experience.

### Features

* **General settings tab** — a new first tab for the settings that do not belong
  to a single feature: the **summon hotkey** (double-tap <kbd>Ctrl</kbd>,
  <kbd>Alt</kbd>, <kbd>Shift</kbd>, or <kbd>Win</kbd>), the **interface
  language** (Auto / English / Simplified Chinese, moved out of Display), the
  **data directory** (empty uses the default app-data folder; a restart is
  required), and **start on boot** (moved out of Display).
* **Agent configuration mode** — the Agent tab now chooses between reusing your
  AI configuration (`Same as AI configuration`, the default) or using a
  separate provider, model, base URL, and API key (`Custom`).
* **Agent permissions** — `Limited` (the default) runs safe actions
  automatically and asks before dangerous ones; `Full` lets the agent act freely
  without confirmation.
* **Conversation rename** — the conversation name is shown in the chat header
  and can be renamed by right-clicking it. History entries support right-click
  **rename** and **delete**.
* **Window pin** — a pin icon keeps the overlay open when you click away; click
  it again to let the window hide as usual.
* **Keyboard control for agent confirmations** — <kbd>1</kbd> allows,
  <kbd>2</kbd> denies, and <kbd>Ctrl</kbd>+<kbd>C</kbd> aborts, so an agent
  driving the mouse never leaves you stuck.
* **Settings and help in About** — the About tab now documents every shortcut
  and slash command ("Shortcuts and commands") and explains features, usage, and
  the tray icon ("Help").
* **`Ctrl+,` opens Settings** from the overlay.

### Changed

* **No default chat model or base URL** — the chat model and base URL start
  empty and must be configured. The fields show a placeholder only, and starting
  a chat without a model surfaces the error "No chat model selected. Set one in
  Settings."
* **Settings window** — the native title bar (the light bar and its duplicate
  close button) is gone; the window is undecorated with the in-app drag region
  and close button.
* **Opening a saved conversation lands at the input box**, so the composer is
  visible without stretching the window. <kbd>Ctrl</kbd>+<kbd>Home</kbd> and
  <kbd>Ctrl</kbd>+<kbd>End</kbd> jump to the top and bottom of the chat.
* **Agent completion panel** — the finished panel now renders markdown and has a
  dismiss control.

### Fixed

* Settings tab switching is no longer laggy.
* The settings window shows the correct QuickAI taskbar icon.
* The chat input box no longer renders half cut off while streaming.
* The history and settings buttons now show hover tooltips, matching the
  screenshot button.

## 0.0.1 (2026-10-12)

The first QuickAI release. QuickAI is a fork of
[ThukiWin](https://github.com/ayzekhdawy/thukiwin), reworked as a cloud-only,
bilingual Windows overlay.

### Features

* **Cloud-only AI providers** — OpenAI, Anthropic, and any OpenAI-compatible
  endpoint (custom base URL, model, and API key). API keys are stored locally in
  a SQLite `app_config` table.
* **Bilingual interface** — English and Simplified Chinese, auto-detected from
  the system language with a manual switcher on the Settings → Display tab.
* **Windows overlay** — double-tap <kbd>Ctrl</kbd> to summon a floating overlay
  from any app, including fullscreen ones; highlight text first to open with it
  pre-filled as a quote.
* **Main chat, vision, and extended reasoning** — streaming responses, image
  attachments and `/screen` captures sent to the provider as vision input, and
  `/think` mapped to the provider's reasoning mode.
* **Computer control via `/do`** — agent mode drives your desktop using native
  OpenAI / Anthropic tool calling.
* **Utility commands** — `/translate`, `/rewrite`, `/tldr`, `/refine`,
  `/bullets`, and `/todos`.
* **Conversation history** persisted in a local SQLite database.
* **Minibar mode** and desktop notification toasts.

### Removals

* Removed local Ollama inference and the local inference configuration.
* Removed the self-hosted agentic web-search pipeline (`/search`).
* Removed the local OpenAI-compatible gateway.
* Removed text-to-speech (read aloud) and the notification-sound option.
* Removed Turkish intent-detection phrases (English and Chinese are kept).

### Build & Release

* Releases are cut by hand: tag the commit and publish a GitHub Release, which
  triggers CI to build and upload the assets.
* Each release publishes an **NSIS installer** and a **portable zip**
  (`QuickAI_<version>_x64_portable.zip`).
