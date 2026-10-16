# Changelog

All notable changes to QuickAI are documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the changelog follows the
[Conventional Commits](https://www.conventionalcommits.org/) grouping. Entries
are written by hand as part of the manual release process (see
[RELEASING.md](RELEASING.md)).

## [0.1.0](https://github.com/yorelll/quickai/compare/v0.0.3...v0.1.0) (2026-10-16)


### Features

* **backend:** configurable hotkey, agent mode/permissions, data dir, rename ([27c3268](https://github.com/yorelll/quickai/commit/27c3268925f4692685d455b3a71a55ef20959cf7))
* **backend:** theme, skills, hotkey semantics, folder picker, durable taskbar hiding ([a749623](https://github.com/yorelll/quickai/commit/a749623ab3867bf2f2c71c5b34451d024accc0f1))
* **chat:** /add skill picker, scroll and layout fixes, keyboard control ([35da460](https://github.com/yorelll/quickai/commit/35da4605e21cb4aa738fdb7d29bb5c09c43c4156))
* **chat:** rename, pin, agent keyboard control, layout fixes ([dda9b87](https://github.com/yorelll/quickai/commit/dda9b8721bdd74e7a6c6f3f576c8eec7ee9f82e3))
* **settings:** General tab additions, About dialogs, Skills UI, light theme ([e6b6d42](https://github.com/yorelll/quickai/commit/e6b6d42c33054e66a41b9a0d52810c31682679e6))
* **settings:** General tab, no default model, agent config UI, About help ([121b697](https://github.com/yorelll/quickai/commit/121b69716c0d9c492cb2b09cb7afff01efb87345))


### Bug Fixes

* compile on non-Windows targets ([2eeeef5](https://github.com/yorelll/quickai/commit/2eeeef5dc9e7fbce24627318570a99b9a9483fa3))
* gate Windows-only items that are dead on other targets ([5008b3a](https://github.com/yorelll/quickai/commit/5008b3a372e5e50dbf0033a9f8f66bc2bffd701b))
* **test:** make the seed-failure test exercise one branch on every platform ([5053aed](https://github.com/yorelll/quickai/commit/5053aed267b850529f001b76911f7cce4abb4910))

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
