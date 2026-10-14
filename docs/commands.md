# Commands

Commands are typed at the start of a message using the `/` prefix. Press `/` to
open the command suggestion menu, then Tab to complete or Enter to select.

Commands that operate on text follow a consistent input priority:

1. **Highlighted text + no typed text:** highlighted text is the input
2. **No highlighted text + typed text after command:** typed text is the input
3. **Both present:** highlighted text is the primary input; typed text is
   appended as an additional instruction

This means you can highlight a paragraph anywhere on screen, summon QuickAI with
your hotkey (<kbd>Ctrl</kbd> by default), type a command, and hit Enter without
typing anything else.

> All commands run against the cloud provider configured in Settings. There is
> no local model server. Set a **chat model** on the AI tab first — it has no
> default, and a chat without one reports "No chat model selected. Set one in
> Settings."

---

## /screen

Captures your screen and attaches it as context for the current message.

**Usage:** `/screen [optional message]`

**Examples:**

- `/screen`: sends a screenshot with no additional message
- `/screen what is this error?`: attaches a screenshot and asks the question

**Behavior:** The screenshot is taken the moment you press Enter. QuickAI's own
window is excluded from the capture: no flicker, no hide. The image appears in
your message bubble exactly like a pasted screenshot, and is sent to the
provider as vision input.

**Composable:** `/screen` works with all other commands. `/screen /rewrite`
captures the screen and rewrites whatever text the model sees. `/screen /think`
enables extended reasoning on the captured content.

**Limit:** One `/screen` capture per message. You may also attach up to 3 images
manually (paste, drag, or the camera button) for a total of 4 images per message.

**Permission:** On Windows, no special permission is needed — screen capture
works out of the box.

---

## /think

Enables extended reasoning before the model responds. The model works through the
problem step by step internally before writing its answer. With reasoning-capable
models this maps to the provider's native reasoning mode (for example, OpenAI
reasoning models or Anthropic extended thinking).

**Usage:** `/think [optional message or highlighted text]`

**Examples:**

- `/think` (with highlighted text): reasons through the selected content
- `/think what are the tradeoffs of a monorepo vs polyrepo?`: asks a question
  with deep reasoning enabled

**Behavior:** A collapsible "Thinking" block appears above the response showing
the model's reasoning. The final answer appears below it as normal.

**Composable:** `/think` works with all utility commands. `/think /tldr`
summarizes with extended reasoning enabled.

---

## /translate

Translates text to another language.

**Usage:** `/translate [language] [text]` or `/translate` with highlighted text

**Examples:**

- `/translate` (with highlighted text): auto-detects language and translates.
  Non-English input translates to English; English input translates to
  Simplified Chinese
- `/translate zh` (with highlighted text): translates highlighted text to Chinese
- `/translate Spanish meeting notes here`: translates the typed text to Spanish

**Language format:** You can specify the target language by full name (`French`),
ISO code (`fr`, `fra`), or common shorthand. The model interprets it flexibly.

**Default behavior:** If no language is specified, non-English input is
translated to English and English input is translated to Simplified Chinese.

---

## /rewrite

Rewrites text to read more naturally and clearly.

**Usage:** `/rewrite [text]` or `/rewrite` with highlighted text

**Examples:**

- `/rewrite` (with highlighted text): rewrites the selected text
- `/rewrite so basically what happened was i was trying to fix the bug`: rewrites
  the typed text

**Behavior:** Preserves the original meaning while improving flow and
readability. Output only: no commentary or explanation.

---

## /tldr

Summarizes text into 1-3 short, direct sentences.

**Usage:** `/tldr [text]` or `/tldr` with highlighted text

**Examples:**

- `/tldr` (with highlighted text): summarizes the selected content
- `/tldr [paste a long article]`: summarizes the typed or pasted text

**Behavior:** Captures the core message, key decision, or critical takeaway.
Skips background detail and qualifications.

---

## /refine

Fixes grammar, spelling, and punctuation while preserving your voice.

**Usage:** `/refine [text]` or `/refine` with highlighted text

**Examples:**

- `/refine` (with highlighted text): corrects the selected text
- `/refine hey just wanted to follow up on the thing we discussed`: cleans up the
  typed text

**Behavior:** Corrects errors and smooths rough phrasing without restructuring or
adding new ideas. Your original tone and meaning stay intact.

---

## /bullets

Extracts key points from text as a markdown bullet list.

**Usage:** `/bullets [text]` or `/bullets` with highlighted text

**Examples:**

- `/bullets` (with highlighted text): extracts key points from the selection
- `/bullets [paste meeting notes]`: extracts key points from the typed or pasted
  content

**Behavior:** Each point is a concise, self-contained statement. Ordered by
importance or logical sequence. Filler and repetition are removed. Output is a
`- ` prefixed markdown list.

---

## /todos

Summarizes what a piece of text is about, then extracts every task, action item,
and commitment as a markdown checkbox list.

**Usage:** `/todos [text]` or `/todos` with highlighted text

**Examples:**

- `/todos` (with highlighted text): summarizes and extracts to-dos from the
  selected text
- `/todos [paste a conversation or notes]`: processes the typed or pasted content

**Behavior:** Responds in two parts: a short paragraph explaining the context and
what is at stake, followed by a `- [ ]` checkbox list of all tasks. Each to-do
includes who is responsible (if mentioned) and any deadline or timeframe.
Observations and background that imply no action are excluded.

---

## /do

Enters agent mode: the AI autonomously controls your desktop to complete the
described task. It takes screenshots, analyzes them with the configured agent
provider, and executes mouse/keyboard actions in a loop until the task is done.

**Usage:** `/do <task description>`

**Examples:**

- `/do Open Notepad and type Hello World`: launches Notepad and types the text
- `/do Find the Settings app and open it`: navigates the Start menu to find and
  open Settings
- `/do Close the current window`: presses Alt+F4 on the active window
- `/do Copy the selected text and paste it into a new document`: performs
  clipboard operations

**Behavior:**

1. A screenshot is captured (QuickAI's own window is excluded)
2. The screenshot and your task are sent to the agent provider (see
   **Requirements** below)
3. The model returns structured tool calls (click, double-click, right-click,
   drag, type, key press, scroll, launch app, done)
4. Actions are executed via Win32 `SendInput` with a 500 ms delay between each
5. A new screenshot is taken and the loop repeats until the model signals that
   the task is complete or you stop it

**Safety:**

- Maximum 30 iterations per task (prevents infinite loops)
- 500 ms delay between actions so you can follow along
- Click the **Stop** button to cancel at any time
- The confirmation policy comes from **Agent permissions** on the Settings →
  Agent tab:
  - **Limited** (default) — safe actions (clicks, drags, scrolling, plain
    typing) run automatically; **dangerous** actions require your explicit
    approval. Dangerous means anything that can start or terminate arbitrary
    software: launching a program/file/URL, or a system-level key press such as
    <kbd>Win</kbd>+<kbd>R</kbd>, <kbd>Win</kbd>, <kbd>Ctrl</kbd>+<kbd>Esc</kbd>,
    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd>, or <kbd>Alt</kbd>+<kbd>F4</kbd>.
  - **Full** — the agent acts freely and never asks.
- A status indicator (amber banner with pulsing dot) shows the current phase:
  Capturing, Analyzing, or Executing

**Keyboard control:** while a confirmation is pending you do not need the mouse
— useful when the agent is driving it. Press <kbd>1</kbd> to **allow**,
<kbd>2</kbd> to **deny**, or <kbd>Ctrl</kbd>+<kbd>C</kbd> to **abort** the run.
The confirmation panel shows this hint, and the shortcuts are ignored while you
are typing in a text field.

**Minibar integration:** When you switch away from QuickAI while an agent task is
running, the overlay shrinks to a minibar. The minibar shows a status dot (amber
= running) and the last action. Click it to restore the full overlay and monitor
progress.

**Completion panel:** when a run finishes, the panel shows the closing summary
rendered as markdown with a dismiss (×) control to clear it.

**Requirements:** Agent mode needs a vision-capable model. By default it uses
your AI configuration (the provider, model, base URL, and API key from the
Settings → AI tab); set the Agent tab's **Configuration** to **Custom** to give
it its own provider, model, base URL, and API key instead. Configure this on the
**Agent** tab in Settings.

**Not composable:** `/do` does not combine with other commands. It is a
standalone mode that takes over the input.
