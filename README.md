<h1 align="center">
  QuickAI
</h1>

<p align="center">
  <img src="public/quickai-logo.png" alt="QuickAI logo" width="300" />
</p>

<p align="center">
  A bilingual (English + 简体中文) AI assistant overlay for Windows, powered by cloud models.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows11&logoColor=white" alt="Platform: Windows" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Rust-stable-CE422B?logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/SQLite-bundled-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
</p>

---

> ## This is a fork
>
> **QuickAI is a fork of [ThukiWin](https://github.com/ayzekhdawy/thukiwin) by
> [ayzekhdawy](https://github.com/ayzekhdawy)** (itself a Windows port of
> [Thuki](https://github.com/quiet-node/thuki) by Logan Nguyen). All original
> design and code credit belongs to the upstream authors.
>
> QuickAI reworks that foundation into a **cloud-only**, **bilingual** assistant:
> local Ollama inference, the self-hosted web-search pipeline, the local
> gateway, and the text-to-speech / sound features have been removed. Bug
> reports and feature requests for this fork belong in
> [this repository](https://github.com/yorelll/quickai/issues), not upstream.

## What it is

QuickAI is a lightweight Windows overlay that puts an AI assistant on top of
whatever you are doing. Double-tap your summon key (<kbd>Ctrl</kbd> by default,
customizable) to summon it from any app — including fullscreen ones — ask, get
an answer, and dismiss. Highlight text first and QuickAI opens with it
pre-filled as a quote.

It is **cloud-only**: you bring an OpenAI, Anthropic, or OpenAI-compatible API
key, configure a model, and every request goes straight to that provider. Your
conversations and API keys are stored locally in a SQLite database; nothing is
sent anywhere except to the provider you configured.

## Features

- **Summon from anywhere:** double-tap your summon key (<kbd>Ctrl</kbd>,
  <kbd>Alt</kbd>, <kbd>Shift</kbd>, or <kbd>Win</kbd> — your choice) to show the
  overlay over any app, including fullscreen apps.
- **Context-aware quotes:** highlight text, then summon QuickAI, to open it with
  the selection pre-filled as a quote.
- **Cloud providers:** OpenAI, Anthropic, and any OpenAI-compatible endpoint
  (custom base URL, model, and API key). Configure them in Settings.
- **Bilingual interface:** English and Simplified Chinese, auto-detected from
  your system language, with a switcher in Settings.
- **Main chat & vision:** streamed responses; attach images or capture your
  screen and they are sent to the model as vision input.
- **Extended reasoning:** type `/think` to have the model reason step by step
  before answering.
- **Computer control (`/do`):** let the AI take over your desktop and complete a
  task autonomously, using native OpenAI / Anthropic tool calling. Choose
  **Limited** permissions (safe actions run automatically, dangerous ones ask
  first) or **Full** (never asks), and allow, deny, or abort from the keyboard.
- **Utility commands:** `/translate`, `/rewrite`, `/tldr`, `/refine`,
  `/bullets`, `/todos`.
- **Conversation history:** persisted locally and reopenable across sessions;
  rename a conversation from the chat header or rename/delete entries in the
  history list.
- **Pin the window:** keep the overlay open when you click away.
- **Minibar mode:** when you switch windows the overlay shrinks to a slim
  always-on-top strip so you never lose track of it.
- **Desktop notifications:** get a toast when a response finishes while you are
  in another window.
- **Multi-monitor support:** screenshots and overlay positioning work across all
  monitors.

> **Removed from upstream:** local Ollama inference, the agentic web-search
> pipeline (`/search`), the local OpenAI-compatible gateway, text-to-speech
> (read aloud), and the notification-sound option.

## Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| **OS** | Windows 10 64-bit (1809+) | Windows 11 recommended |
| **RAM** | 4 GB | Inference runs in the cloud |
| **Disk** | ~200 MB (app) | Plus space for your local conversation database |
| **API key** | Required | OpenAI, Anthropic, or an OpenAI-compatible provider |
| **Model** | Required | No default model — set one on the Settings → AI tab before chatting |

### Build requirements (for building from source)

- [Bun](https://bun.sh) v1.3+
- [Rust](https://rustup.rs) stable toolchain
- [Microsoft Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  (C++ build tools with MSVC v143 + Windows 10/11 SDK)

## Download

Every release publishes two assets. Pick whichever suits you:

### Option 1 — NSIS installer (recommended)

1. Download `QuickAI_<version>_x64-setup.exe` from the
   [latest release](https://github.com/yorelll/quickai/releases/latest).
2. Run the installer.
3. Launch QuickAI from the Start Menu or desktop shortcut. It appears in your
   system tray.

### Option 2 — Portable zip (no installation)

1. Download `QuickAI_<version>_x64_portable.zip` from the
   [latest release](https://github.com/yorelll/quickai/releases/latest).
2. Extract the zip anywhere and run `quickai.exe`.

The portable build keeps all of its data in the same per-user app-data
directory as the installer build, so you can switch between the two freely.

> **No special permissions needed on Windows.** The global hotkey and screen
> capture work out of the box; there is no Accessibility or Screen Recording
> permission gate.

## Getting Started

On first launch, open **Settings** (the gear icon, or press
<kbd>Ctrl</kbd>+<kbd>,</kbd>) and configure a provider on the **AI** tab:

1. Choose a provider: **OpenAI**, **Anthropic**, or **OpenAI-compatible**.
2. Enter your **API key** (stored locally in QuickAI's SQLite database).
3. **Enter a model** — there is no default, so the field starts empty (it shows
   a placeholder only). For the OpenAI-compatible provider, also enter a base
   URL.
4. Optionally tune the **General** tab: the summon hotkey, interface language,
   data directory, and start-on-boot.
5. Optionally configure **agent mode** on the **Agent** tab: keep it on
   *Same as AI configuration*, or switch to *Custom* for its own
   provider/model/base URL/key, and pick **Limited** or **Full** permissions.

Then double-tap your summon key and start asking. The **About** tab lists every
shortcut and command, plus help.

## Build from Source

```powershell
# Clone and install dependencies
git clone https://github.com/yorelll/quickai.git
cd quickai
bun install

# Launch in development mode
bun run dev
```

To produce a release build (frontend + NSIS installer):

```powershell
bun run build:all
```

Output:

- Installer: `src-tauri/target/release/bundle/nsis/QuickAI_<version>_x64-setup.exe`
- Standalone executable: `src-tauri/target/release/quickai.exe`

> This local build is for development only. Publishable release artifacts are
> produced by CI, not by `bun run build:all` — see
> [RELEASING.md](RELEASING.md#release-artifacts).

## Configuration

QuickAI reads a small set of environment variables. Copy `.env.example` to
`.env` (gitignored) and adjust as needed.

| Variable | Description | Default |
|---|---|---|
| `VITE_QUOTE_MAX_DISPLAY_LINES` | Maximum lines shown in the quote preview. | `4` |
| `VITE_QUOTE_MAX_DISPLAY_CHARS` | Maximum characters shown in the quote preview. | `300` |
| `VITE_QUOTE_MAX_CONTEXT_LENGTH` | Maximum characters of selected context sent as prompt context. | `4096` |

Provider settings (provider, model, base URL), API keys, the system prompt, and
the General-tab options (hotkey, language, data directory, start-on-boot) are
configured in the in-app **Settings** window (and its `config.toml`), not via
environment variables.

See [docs/configurations.md](docs/configurations.md) for the full reference and
[docs/commands.md](docs/commands.md) for the slash-command reference.

## Windows-Specific Details

### Hotkey

QuickAI uses a low-level Windows keyboard hook (`SetWindowsHookExW` with
`WH_KEYBOARD_LL`) to detect a double-tap of your summon key globally. This works
in all applications, including fullscreen apps and elevated (admin) windows on
Windows 10 1809+. The summon key is configurable on the Settings → **General**
tab: <kbd>Ctrl</kbd> (default), <kbd>Alt</kbd>, <kbd>Shift</kbd>, or
<kbd>Win</kbd>.

- **Activation window:** 400 ms between the two presses
- **Cooldown:** 600 ms after each activation to prevent accidental re-triggers

### Overlay window

QuickAI uses Tauri's `always_on_top` and `skip_taskbar` APIs combined with Win32
window styles to float above all other windows without appearing in the taskbar
or stealing focus.

### Screen capture

Full-screen capture uses the Windows GDI `BitBlt` API. Type `/screen` in the chat
to capture your screen and attach it as context; QuickAI's own window is excluded
from the capture.

### Context capture

When you summon QuickAI (double-tap your hotkey) with text selected, QuickAI
uses clipboard simulation (Ctrl+C via `SendInput`) to capture the selection, then
restores the original clipboard contents. The cursor position is read via
`GetCursorPos` to position the overlay near your cursor.

### Computer control (agent mode)

QuickAI's `/do` command (or natural language such as "open notepad") lets the AI
autonomously control your desktop:

1. **Capture** — a screenshot of your screen is taken (excluding QuickAI's own
   window).
2. **Analyze** — the screenshot and your task are sent to the configured agent
   provider.
3. **Execute** — the model returns structured tool calls which are carried out
   via Win32 `SendInput` (click, type, key press, scroll, launch).
4. **Repeat** — a new screenshot is taken and the loop continues until the task
   is done or you stop it.

**Safety:**

- A maximum of 30 iterations prevents infinite loops.
- A 500 ms delay between actions lets you follow along.
- Click **Stop**, or press <kbd>Ctrl</kbd>+<kbd>C</kbd>, to abort at any time.
- The consent policy comes from **Agent permissions** on the Settings → Agent
  tab: **Limited** (default) runs safe actions automatically and asks before
  dangerous ones (launching a program, or a system-level key press such as
  <kbd>Win</kbd>+<kbd>R</kbd> or <kbd>Alt</kbd>+<kbd>F4</kbd>); **Full** never
  asks.
- While a confirmation is pending, press <kbd>1</kbd> to allow, <kbd>2</kbd> to
  deny, or <kbd>Ctrl</kbd>+<kbd>C</kbd> to abort — no mouse required.

### Minibar mode

When you switch away from QuickAI while it is generating a response or running
an agent task, the overlay shrinks to a **minibar** — a thin always-on-top strip.
The minibar shows a status dot (green = idle/done, amber = working, red = error)
and a preview of the last message or action. Click it to restore the full
overlay. When a response finishes while you are in another window, a desktop
notification is sent.

## Architecture & Security

<details>
<summary>Click to expand</summary>

QuickAI is a **Tauri v2** app (Rust backend + React/TypeScript frontend). It has
no backend service of its own: inference happens entirely at the cloud provider
you configure.

### Stack

- **Frontend:** React 19 + TypeScript + Tailwind CSS 4 + Vite
- **Backend:** Rust with Tauri v2 + Win32 API (windows crate)
- **Database:** SQLite (bundled, local only)
- **AI:** OpenAI / Anthropic / OpenAI-compatible HTTP APIs

### Security model

1. **Frontend (Tauri/React):** runs in a secure system webview (WebView2 on
   Windows) with restricted IPC. Streaming uses Tauri's Channel API; the Rust
   backend sends typed `StreamChunk` variants and the frontend accumulates
   tokens into React state.

2. **Network egress:** the only network calls are requests to the AI provider
   you configure (OpenAI, Anthropic, or your custom OpenAI-compatible endpoint).
   There is no telemetry and no first-party server.

3. **Local storage only:** conversations and API keys are stored in a local
   SQLite database in the app-data directory. Keys are never sent to anyone
   except the provider they belong to.

4. **Agent-mode input simulation:** when `/do` is invoked, QuickAI uses Win32
   `SendInput` to simulate mouse and keyboard events. Screenshots are captured
   via GDI `BitBlt` and sent as base64 images to the configured provider. No
   remote-control or screen-sharing service is involved.

### Window lifecycle

The app starts hidden. The hotkey or tray menu shows it. The window close button
hides (not quits); quit is available from the tray.

</details>

## Contributing

Contributions are welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) to get
started, and please follow the [Code of Conduct](CODE_OF_CONDUCT.md). See
[RELEASING.md](RELEASING.md) for how releases are cut.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

## Acknowledgments

- [ThukiWin](https://github.com/ayzekhdawy/thukiwin) by
  [ayzekhdawy](https://github.com/ayzekhdawy) — the direct upstream of this fork.
- [Thuki](https://github.com/quiet-node/thuki) by Logan Nguyen — the original
  macOS app that ThukiWin was ported from.
