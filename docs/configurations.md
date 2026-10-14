# Configurations

QuickAI is configured in three places:

1. **Environment variables** (`.env`) — build/dev-time defaults, read by the
   Vite frontend via `import.meta.env`.
2. **The Settings window** — provider, model, base URL, API keys, language,
   hotkey, data directory, and window/quote options, edited in the app.
3. **`config.toml`** — the on-disk configuration file, editable by hand or
   through the Settings window.

> QuickAI is **cloud-only**. There is no local model server to configure. You
> supply an API key for OpenAI, Anthropic, or an OpenAI-compatible endpoint.

---

## Environment variables

### Setup

```powershell
copy .env.example .env
```

Edit `.env` to override any defaults. `VITE_`-prefixed changes take effect on
the next `bun run dev` or `bun run build:all`.

> `.env` is gitignored. `.env.example` is committed as the reference template.

### Reference

| Variable | Description | Default | Type |
| :--- | :--- | :--- | :--- |
| `VITE_QUOTE_MAX_DISPLAY_LINES` | Maximum number of lines shown in the quote preview. Lines beyond this limit are truncated with `...`. Empty lines in the selection are skipped and do not count toward this limit. | `4` | Positive integer |
| `VITE_QUOTE_MAX_DISPLAY_CHARS` | Maximum total characters shown in the quote preview. If a line would push the total past this limit, it is truncated mid-line with `...`. | `300` | Positive integer |
| `VITE_QUOTE_MAX_CONTEXT_LENGTH` | Maximum length (in characters) of selected context text included in the prompt sent to the model. This is a security and performance cap; longer selections are silently truncated before reaching the provider. | `4096` | Positive integer |

`VITE_GIT_COMMIT_SHA` is injected by CI at build time and shown on the Settings
**About** tab. It is not meant to be set by hand.

The system prompt is **not** an environment variable. Set it with `[prompt]
system` in [`config.toml`](#configtoml), or leave it empty to use the built-in
assistant persona.

### Validation rules

All numeric configuration values are validated at startup:

- **Missing or empty** values fall back to the default.
- **Non-numeric** values (e.g. `abc`) fall back to the default.
- **Zero or negative** values fall back to the default.
- **Decimal** values are floored to the nearest integer (e.g. `5.7` becomes `5`).
- **Infinity** falls back to the default.

### File precedence

Vite loads `.env` files in the following order (later files override earlier
ones):

| File | Purpose | Committed |
| :--- | :--- | :--- |
| `.env.example` | Reference template with documented defaults | Yes |
| `.env` | Local configuration | No (gitignored) |
| `.env.local` | Local overrides (highest priority) | No (gitignored via `*.local`) |
| `.env.development` | Dev-only overrides (loaded when `bun run dev`) | Optional |
| `.env.production` | Prod-only overrides (loaded when `bun run build:all`) | Optional |

---

## Settings window

Open Settings from the gear icon in the overlay, or press <kbd>Ctrl</kbd>+<kbd>,</kbd>.
The window has five tabs, in this order:

### General

The settings that do not belong to a single feature.

| Setting | Description |
| :--- | :--- |
| **Summon hotkey** | The key you double-tap to summon the overlay: `ctrl` (default), `alt`, `shift`, or `win`. Pick one that does not clash with your other shortcuts. |
| **Interface language** | `auto` (follow the Windows display language), `en` (English), or `zh` (Simplified Chinese). Defaults to `auto` (`zh*` → Chinese, otherwise English). |
| **Data directory** | Where QuickAI keeps its database and saved images. Empty means the default per-user app-data directory. **A restart is required** for a change to take effect. |
| **Start on boot** | Register QuickAI to launch when you sign in (a Windows Task Scheduler entry, not a `config.toml` field). |

### AI

The provider used for the main chat, vision, and `/think`.

| Setting | Description |
| :--- | :--- |
| **Provider** | `openai`, `anthropic`, or `openai_compatible`. |
| **Model** | Provider-specific model name. **There is no default** — the field starts empty and shows a placeholder (`e.g. gpt-4o`) only. Suggested values include `gpt-4o`, `gpt-4o-mini`, `o4-mini`, `gpt-4.1` (OpenAI) and `claude-sonnet-4-5`, `claude-opus-4-1`, `claude-haiku-4-5` (Anthropic). The field is editable, so you can enter any model your account can access. Starting a chat with no model set surfaces the error "No chat model selected. Set one in Settings." |
| **Base URL** | API endpoint. **Empty by default**; empty means the provider default: `https://api.openai.com/v1` (OpenAI) or `https://api.anthropic.com` (Anthropic). The field shows the default as a placeholder only. Required for `openai_compatible`. |
| **API key** | Your provider API key. Stored locally in the SQLite `app_config` table (`api_key_openai`, `api_key_anthropic`, `api_key_openai_compatible`). |
| **System prompt** | Optional persona override; empty uses the built-in assistant persona. |

### Display

Window geometry and quote display limits.

| Setting | Description |
| :--- | :--- |
| **Overlay width** | Logical width of the overlay window. |
| **Max chat height** | Maximum height the expanded chat window grows to. |
| **Max images** | Maximum manually attached images per message (a `/screen` capture adds one on top). |
| **Quote limits** | Lines/characters shown in the quote preview and the context-length cap. |

### Agent

How `/do` computer control gets its model and how much it may do without asking.

| Setting | Description |
| :--- | :--- |
| **Configuration** | `Same as AI configuration` (default) reuses the AI tab's provider, model, base URL, and API key. `Custom` reveals the agent's own provider, model, base URL, and API key. |
| **Provider / Model / Base URL / API key** | Shown only in `Custom` mode. The agent needs a vision-capable model. |
| **Agent permissions** | `Limited` (default) runs safe actions automatically and asks before dangerous ones (launching a program or a system-level key press such as <kbd>Win</kbd>+<kbd>R</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd>, or <kbd>Alt</kbd>+<kbd>F4</kbd>). `Full` never asks — the agent may act freely. |

### About

App identity, version, links, a **Shortcuts and commands** list (every keyboard
shortcut and slash command), a **Help** section (features, usage, and the tray
icon), and file actions (reveal app data, refresh `config.toml`, reset all
settings to defaults).

---

## `config.toml`

QuickAI stores its configuration in `config.toml` inside its per-user
application-configuration directory (on Windows, under `%APPDATA%`). The
Settings window writes to this file; you can also edit it by hand and reload it
from Settings.

```toml
[prompt]
system = ""                 # user persona; empty → built-in

[window]
overlay_width = 600.0
max_chat_height = 648.0
max_images = 3

[quote]
max_display_lines = 4
max_display_chars = 300
max_context_length = 4096

[general]                    # activation and app-wide settings
hotkey = "ctrl"              # double-tap key: "ctrl" | "alt" | "shift" | "win"
language = "auto"            # "auto" | "en" | "zh"
data_dir = ""                # empty → default app data dir (applied at startup)

[chat]                       # drives main chat, vision, and /think
provider = "openai"          # openai | anthropic | openai_compatible
model = ""                   # NO default — set one in Settings (placeholder "gpt-4o")
base_url = ""                # NO default — empty → provider default

[agent]                      # drives /do computer control
mode = "same_as_chat"        # "same_as_chat" | "custom"
provider = "openai"          # only used when mode == "custom"
model = ""                   # only used when mode == "custom"
base_url = ""                # only used when mode == "custom"
permission = "limited"       # "limited" | "full"
```

Notes:

- **`[chat].model` has no default.** The Settings field shows only a placeholder
  (`gpt-4o`); starting a chat while it is empty surfaces a `missing_model` error
  ("No chat model selected. Set one in Settings."). `[chat].base_url` is likewise
  empty by default — an empty value resolves to the provider's default URL at
  request time, and the UI shows that default as a placeholder.
- **`[general].data_dir`** is read once at **startup**, so changing it requires a
  restart. Empty (or whitespace) means the default per-user app-data directory.
- **`[agent].mode = "same_as_chat"`** (the default) makes the agent reuse the
  `[chat]` provider, model, base URL, **and** the chat provider's API key;
  `"custom"` uses the `[agent]` provider/model/base URL and its own API key.
- **`[agent].permission = "limited"`** runs safe actions automatically and asks
  for approval before dangerous ones; `"full"` never asks.
- API keys are **not** stored in `config.toml`; it is a plain-text file. Keys
  live in the local SQLite `app_config` table.
- A missing section or field falls back to the compiled default.
- Values outside the accepted range fall back to the default. If the file
  cannot be parsed, QuickAI backs it up as `config.toml.corrupt-<timestamp>` and
  starts from defaults.
