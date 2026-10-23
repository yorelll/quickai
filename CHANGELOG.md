# Changelog

All notable changes to QuickAI are documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the changelog follows the
[Conventional Commits](https://www.conventionalcommits.org/) grouping. Entries
are written by hand as part of the manual release process (see
[RELEASING.md](RELEASING.md)).

## 0.0.8 (2026-10-23)

Two layout mechanisms with **measured** root causes, and a summon-key mechanism
that 0.0.7's log **located**. The first two are fixed against measurements taken
during this release; the third is fixed against the traced mechanism, and
whether it restores normal behaviour on a given machine is still for the next
log to confirm — that distinction is kept throughout.

### Features

* **Diagnostics for what remains of the summon-key question.** The
  `[activator]` trace gains four things: every summon-key press records the
  **physical key state at that instant** (`physical=`), the silence since the
  previous event (`idle=`), and the resulting decision (`decision=`, one of
  `Fresh`, `StalePhysical`, `StaleTimeout`, `AutoRepeat`); the hook's
  **install and removal** each log a line with the reason, handle and thread,
  so a summon that silently unhooked the hook would be visible; and a
  **filtered injected summon-key event** logs `injected=true ignored` instead
  of being dropped silently. A negative-`nCode` skip now logs `hook skipped
  code=…`. Format, location and the no-switch behaviour of the log are
  unchanged.

### Changed

* **The `[activator]` key line carries more fields.** 0.0.7 logged
  `vk=… down=… held=… gap=… fired=…`; this release appends `physical=`,
  `idle=` and `decision=`. Old lines remain readable, but key lines from the
  two versions cannot be compared field-for-field.
* **The initial dialog's vertical padding split changed** — 16 top / 32 bottom
  becomes 24 / 24, with the 48 px total unchanged. See Fixed, third item.

### Fixed

* **The summon key needing two double-taps — mechanism located from the
  runtime log.** The 0.0.7 log shows that **after every firing press, that
  press's key-up never reached the hook** (4 firings, 4 missing releases),
  while **every press that did not fire had its release recorded** (7 of 7).
  The internal `is_pressed` flag therefore stuck at `true`. The next gesture's
  first press arrived with the flag still set, was taken for **auto-repeat**
  and ignored, and **did not record `last_trigger`** — so the gesture was void
  and the user needed four presses. Every key-down now **checks the key's real
  physical state against the system** (`GetAsyncKeyState`). A low-level
  keyboard hook's callback runs **before** the asynchronous key state is
  updated — Microsoft documents this — so the query returns the **pre-event**
  state: a true auto-repeat reads *down*, and the first genuine press after a
  lost release reads *up*. A pure decision function classifies the press as
  `Fresh`, `StalePhysical`, `StaleTimeout` or `AutoRepeat`; the first three
  **record the press as the first tap of a new sequence** instead of
  swallowing it. A **1200 ms timeout** is the second, physical-state-
  independent heal: a held key auto-repeats every few tens of milliseconds and
  Windows' initial repeat delay is at most 1 s, so a flag with no event for
  1200 ms cannot describe a held key. **This item is not claimed "completely
  solved":** the mechanism is located and the code is fixed against it, and
  the next log decides. **Runtime check:** see the decision table in the
  release notes — a healed press logs `decision=StalePhysical` (or
  `StaleTimeout`) with `fired=false`, and the next press logs
  `decision=Fresh fired=true`, summoning in one gesture.
* **The mini bar's mascot sat low and then corrected itself.** The mascot was
  an **in-flow flex child of the app root**, positioned relative to the root's
  `h-screen` (100vh) and its padding; the native window shrink is
  **asynchronous**, so its **first paint happened while the viewport was still
  the pre-shrink 113 px** and it landed 8 px low, then moved up roughly 10 px
  once layout settled — the visible "adjustment". The same measurement showed
  the circle squeezed to 48×28 by the root's padding. It is now **anchored to
  the viewport's top-left corner** (`fixed top-0 left-0`), which is the 48×48
  region the native shrink leaves visible: it is centred on the first painted
  frame (measured centre (24,24)) and out of flow, so padding cannot distort
  it. **Runtime check:** click outside to collapse, and confirm the mascot is
  centred the first time you see it.
* **The initial dialog's vertical padding was lopsided (16 top / 32 bottom).**
  The split was hard-coded. Its stated justification — the extra bottom space
  belonging to a drop shadow — **does not hold**: the `--shadow-bar` and
  `--shadow-chat` custom properties are **referenced nowhere** and are absent
  from the build output. The split is now **24 / 24**; the 48 px total is
  unchanged, so `COLLAPSED_WINDOW_HEIGHT` (113) still holds. The backend's
  `WINDOW_BOTTOM_PADDING`, which positions the bar above a selection, changed
  from 32 to 24 in step — otherwise the overlay would sit 8 px too high in
  that case. **Runtime check:** the gap above and below the bar looks the
  same.

### Known limitations

* If a key-up is swallowed by **an earlier-installed low-level hook**, no line
  emitted from inside QuickAI's own hook can **distinguish** that from "the OS
  never delivered it". This is a capability boundary, not a pending fix.
* A single **hook-callback timeout skipped by the system** is invisible in the
  current log, because the hook is never called: the log can prove a release
  was missed, but not why. Its signature is a trace that stops after a
  `fired=true` with no subsequent `hook uninstalled` line.
* Below roughly 146 px the chat header and input overlap; normal use cannot
  reach that height.
* A native resize that produces no CSS viewport change can be neither observed
  nor corrected — recorded since 0.0.6, unchanged.

## 0.0.7 (2026-10-23)

Two **provable** sizing mechanisms are fixed, a file-backed diagnostic log and
single-instance protection are added — and the summon-key symptom is **not**
claimed fixed. It has now survived four attempts, so this release stops
asserting a fifth fix: it rules out the two sizing mechanisms it can prove,
and makes the next failure diagnosable.

*Correction (0.0.8): the log added here **located the mechanism**. After every
firing press its key-up never reached the hook (4 of 4), while every press that
did not fire had its release recorded (7 of 7), leaving the internal "held"
flag stuck at `true`; the next gesture's first press was then taken for
auto-repeat and the gesture voided. 0.0.8 heals the flag against the key's
physical state and a 1200 ms silence timeout. See 0.0.8.*

### Features

* **A diagnostic log file** at `%APPDATA%\com.yorelll.quickai\quickai.log`,
  next to `config.toml` and `skills.toml`. Lines carry UTC ISO-8601 timestamps
  with milliseconds; the live file rotates to `quickai.log.1` when the next
  line would take it past 1 MiB (one previous generation kept). Writes are
  queued through a bounded channel and drained by one writer thread, so no
  producer — in particular the low-level keyboard hook — ever waits on disk;
  a full queue, an unwritable directory or a missing writer drops the line
  silently. The startup trace records the version, the single-instance
  decision, the hotkey's **actual virtual-key pair**, and the main window's
  native state; `[activator]` records whether the hook was installed, and
  `[summon]`, `[minibar]` and config-loading events follow. None of these need
  a switch to be enabled. The frontend's `[quickai:size]` trace is
  development-only (behind a frontend debug flag) and absent from release
  builds; when present it is accepted only under that prefix, one line per
  call, so the webview cannot forge an entry in a file users are asked to
  send.
* **Corrupt-config recovery is recorded.** A `config.toml` parse failure still
  renames the file and reseeds defaults — which resets `[general].hotkey` to
  the default key — but the parse error itself previously went to stderr, which
  a GUI build has nowhere to show. It is now a timestamped log entry. (The
  Settings window already reported that defaults were active; it does not say
  the hotkey was among them.)
* **Single-instance protection.** Launching QuickAI while it is already
  running now forwards an activation to the running instance and exits, before
  any Tauri app exists, so a second copy registers no keyboard hook, no tray
  icon and no window. A session-scoped named mutex is the lock and a named
  auto-reset event is the hand-over channel; the mutex handle is deliberately
  never closed, so a crash cannot leave a stale lock. This is **hardening, not
  an explanation** of the hotkey problem.

### Changed

* **Diagnostics no longer go to stderr.** Startup, hotkey-hook, summon/mini-bar
  and config-loading diagnostics now write to the log file; window-sizing events
  are newly recorded there. A GUI-subsystem process has no console, and a
  redirected stderr file is not reliable on Windows, so the old lines were
  effectively lost.

### Fixed

* **The mini bar shrank its icon but not its window.** The native resize to
  48×48 completes before React commits the mini-bar state, so both
  `ResizeObserver`s — the container's and the document's — fired while the
  overlay still looked visible and re-applied the content size. The result was
  a small icon drawn inside a full-size window. The shrink request now marks
  the interval as *pending* synchronously, before the IPC call, and both
  observers stand down while it is set; a 1 s timeout bounds the suppression so
  a lost reply cannot leave fit-to-content disabled. After applying the resize
  the backend **reads the size back**, accepts one physical pixel of DPI
  rounding, retries once when the window did not reach 48×48, and logs both
  outcomes. **Runtime check:** click outside the overlay and confirm the
  window itself is 48×48.
* **Collapsing history in chat mode kept the drawer's height.** Chat mode's
  container is `h-full`, so clearing the dropdown's inline `minHeight` changed
  no box: the container observer never fired, nothing re-measured, and the
  window kept the height the dropdown had reserved. Both clearing branches —
  non-chat mode and chat mode with history closed — now call the size sync
  explicitly. **Runtime check:** in chat mode, open and close history and
  confirm the window height returns.

### Known limitations

* Two overlapping shrink requests (a click-away and the in-app minimise inside
  one round trip) share one pending flag, so the earlier reply can end the
  later request's suppression early; both requests still shrink or both
  restore.
* A reply that arrives after the timeout still enters the mini bar, now inside
  the window the timeout re-expanded; the next summon recovers. Recorded, not
  hidden.
* The ask-bar drawer's history-collapse case was **not reproduced** during
  investigation and awaits a real-machine log.
* The vertical padding is **16 top / 32 bottom on purpose** (the extra bottom
  space belongs to the shadow), not a layout bug. When the window is taller
  than its content, the surplus lands entirely at the bottom, so "the bottom
  gap grew" is a symptom of an over-tall window.
  *Correction (0.0.8): the shadow rationale was wrong — `--shadow-bar` and
  `--shadow-chat` are referenced nowhere and are absent from the build output.
  The split is now 24 / 24 with the 48 px total unchanged. See 0.0.8.*
* A native resize that produces no CSS viewport change can be neither observed
  nor corrected — recorded since 0.0.6, unchanged.

## 0.0.6 (2026-10-22)

Fixes for the history/scroll symptoms and the summon-key state drift — both
**regressions introduced by 0.0.5** — plus a deliberate change to entrance
animation. These fixes are verified in code; each "Fixed" item still needs the
runtime check named in its entry, because both failures depend on native layout
and event timing that tests cannot reproduce.

### Changed

* **A wholesale transcript replacement renders at rest** — switching
  conversations or loading history now displays the transcript without replaying
  the per-bubble entrance, and only appended messages animate. The 11.5 px
  "settle" was each bubble's own `y: 12` transform; replaying it produced the
  jump. The cost is that the first user bubble after a summon no longer
  animates — the overlay's own summon spring still plays.
* **The window fits its content height** (inherited from 0.0.5) — dragging the
  window taller settles back to the height its content needs. This is
  intentional.

### Fixed

* **The history panel's empty lower half, the short scroll landing, and the
  switch bounce/flash are one regression from 0.0.5.** 0.0.5 added
  `verifyNativeSize` in the same commit as the scroll re-pin (`35a903b`). It read
  `window.innerHeight` **before** awaiting the native size and scale factor, then
  applied a multiplicative correction using a value that could be stale; because
  every resize re-armed verification, each bad correction generated the next.
  Measured before the fix: `innerHeight` cycling between roughly 1784 and 285
  indefinitely, a 428 px scroll shortfall, and 283 px of empty window under the
  input. Verification now runs only after layout has settled (driven by a
  viewport `ResizeObserver`), and a correction is skipped when the observation is
  stale or superseded. **Runtime check:** open history from a blank conversation
  and switch between saved conversations; the panel must fill its area, the
  transcript must land with no further scroll room, and the switch must not
  bounce or flash.
* **The summon key still needing two double-taps was state drift around the
  mini bar.** 0.0.5 removed the dismiss action — the right direction, but not
  sufficient. "Clicking elsewhere" does not hide the overlay; it shrinks it to
  the 48×48 mini bar, so the next summon takes the *Expand* path rather than
  *Show*. Four defects are fixed: a late shrink undoing an expand (the shrink
  command now carries a surface epoch, and the backend refuses a superseded
  one); a lost mini-bar event silently resetting the open conversation (a summon
  no longer replays the entrance when the bar is already on screen); a lost show
  leaving the mini bar on screen with a full-size window (now reconciled); and a
  stale mini-bar flag on a hidden window, readily reachable by pressing
  <kbd>Esc</kbd> while the mini bar is showing (cleared before the summon
  decides, with Show resizing and unminimising unconditionally). The summon key
  still never dismisses; that remains deliberate. **Runtime check:** double-tap
  once right after launch and once after clicking elsewhere to dismiss, and
  confirm one gesture is enough each time.
  *Correction (0.0.7): the symptom persisted. 0.0.7 does not claim it fixed;
  the hotkey predicate and the overlay state machine are unchanged, and that
  release instead rules out two provable sizing mechanisms and adds a
  diagnostic log with which to classify the next failure. See 0.0.7.*

### Known limitations

* A millisecond race can still render the mini bar inside a full-size window; a
  second summon recovers. No data loss and no wrong native size.
* A refused shrink command is not retried automatically; the next summon clears
  the stale flag and recovers.
* The frontend's "UI is visible" mirror lags one React commit (~16 ms); a summon
  inside that window may replay the entrance unnecessarily.
* A native resize that produces no CSS viewport change can be neither observed
  nor corrected; the cost is the old empty-window symptom, not clipping.
* Below roughly 146 px the chat header and input overlap; normal use cannot
  reach that height.

## 0.0.5 (2026-10-20)

A chat-layout rebuild and a hotkey that can no longer dismiss, plus a
conventional tray interaction, dismissible Settings errors, and a batch of
skills and copy fixes.

### Features

* **Dismissible error popups** — skill load failures, skill save failures, and
  the General tab's start-on-boot failure now open a popup closed with **×** or
  <kbd>Esc</kbd>. A dismissed error stays dismissed; an undismissed one opens
  again when Settings is reopened. That is deliberate: an unacknowledged
  failure must not be silently discarded.

### Changed

* **The tray icon now follows convention** — **left-click opens or raises** the
  overlay directly (no menu first, and never a hide), while **right-click
  shows the menu**, which contains only **Settings** and **Quit**. The labels
  follow the interface language and update immediately when it changes, with
  no restart.
* **The summon key only opens, never closes** — one double-tap opens the
  overlay from hidden, restores it from the mini bar, or raises it when it is
  already on screen. Dismissal belongs to <kbd>Esc</kbd>, <kbd>Ctrl</kbd>+<kbd>W</kbd>,
  or the close button.
* **The chat layout is a viewport-filling flex column** — the header and input
  bar are fixed and the transcript absorbs the difference in window height, so
  a short window shrinks the transcript instead of pushing the input out of
  view. The window is now sized from **content requirements** (transcript
  content, chat chrome, input bar, banners) rather than from the container,
  which fills the viewport in chat mode. The collapsed height is the real ask-bar
  height (the previous value was 53 px short of it), and placement uses the
  monitor's **work area** in **logical coordinates**, so a scaled display no
  longer places the window under the taskbar or off-screen.
* **The window fits its content** — after you drag the window taller, it
  settles back to the height its content needs. This is intentional. With the
  structural fix, a wrong native height costs transcript space rather than
  clipping the input bar.
* **A skill selected twice in one turn is sent once** — the picker still allows
  the same skill to be selected twice, but the turn de-duplicates by first
  occurrence, and the backend enforces the same rule when it assembles the
  prompt, so both the chat and agent paths are covered.

### Fixed

* **One double-tap now summons the overlay** — 0.0.4 attempted this by deciding
  on the native window state and removing the cooldown, but the problem
  remained. This version changes the method: it removes the *dismiss* action
  entirely instead of adjusting the predicate. Two races that made the window
  "look unresponsive" are also fixed: a summon during the exit animation now
  cancels that exit, and expanding a mini bar that <kbd>Win</kbd>+<kbd>D</kbd>
  minimized now restores the window before showing it.
  *Correction (0.0.6): this did not resolve the problem either. Removing the
  dismiss action was necessary but not sufficient; the remaining cause was state
  drift around the mini bar, which is what "clicking elsewhere" actually
  produces. See 0.0.6.*
* **The chat interface is no longer clipped** — the bottom input no longer
  shows only half of itself while streaming, and switching conversations,
  opening the history dropdown, and restoring from the mini bar all display
  fully. 0.0.4 tried changing the measurement from `getBoundingClientRect()` to
  `offsetHeight`; that did not resolve it. This version changes the structure so
  the chat column fills the window and the input is always inside it.
  *Correction (0.0.6): the layout fix held, but the native-size verification
  added in the same commit read the viewport height before awaiting the native
  size, corrected from a stale value, and oscillated. That regression produced
  the history panel's empty lower half, a 428 px scroll shortfall, and the
  conversation-switch bounce. See 0.0.6.*
* **Copying a reply no longer produces a leading blank line** — both the copy
  button and the copy shortcut trim leading blank lines before writing to the
  clipboard.
* **A skill error no longer sits in Settings forever** — the persistent inline
  alert was not introduced in 0.0.4; it already existed in 0.0.3. What 0.0.4's
  tab keep-alive changed is that the alert now **outlived tab switches**, so it
  appeared impossible to clear. It is now the dismissible popup described above.
* **The tray icon's old behaviour** (left-click opened a menu, right-click
  opened the overlay directly) is replaced by the left-click/right-click
  behaviour described under Changed.

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
* **The installer is about 1.7 MB larger.** The syntax-highlighting dependency
  bundles one lazy-loaded chunk per programming language, so the uncompressed
  frontend assets grow by about 10 MB — but Tauri embeds those compressed, so the
  shipped installer grows by about 1.7 MB (7.4 MB installer, 9.6 MB portable
  bundle). Only the chunk for a language actually being highlighted is fetched at
  runtime, roughly +60 kB gzipped at first paint.
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
  *Correction (0.0.5): this did not resolve the problem — see 0.0.5, which changes
  the method by removing the dismiss action entirely.*
* **The chat input is no longer clipped while streaming** — the window was being
  sized from a measurement that included the entrance animation's scale
  transform.
  *Correction (0.0.5): this did not resolve the problem — see 0.0.5, which changes
  the layout so the chat column fills the window.*
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
