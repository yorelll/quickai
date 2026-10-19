/**
 * English (source) dictionary.
 *
 * `zh.ts` is typed against `keyof typeof en`, so adding a key here without a
 * Chinese translation is a compile error. Every user-visible string in the
 * frontend must live here — including aria-labels, placeholders, tooltips and
 * slash-command descriptions.
 */
export const en = {
  // ─── App identity ────────────────────────────────────────────────────────
  'app.name': 'QuickAI',
  'common.cancel': 'Cancel',

  // ─── Relative time ───────────────────────────────────────────────────────
  'time.justNow': 'just now',
  'time.minutesAgo': '{count}m ago',
  'time.hoursAgo': '{count}h ago',
  'time.daysAgo': '{count}d ago',
  'time.weeksAgo': '{count}w ago',

  // ─── Ask bar ─────────────────────────────────────────────────────────────
  'ask.placeholderIdle': 'Ask a question, or type / to see commands',
  'ask.placeholderReply': 'Reply...',
  'ask.send': 'Send message',
  'ask.stop': 'Stop generating',
  'ask.screenshot': 'Take a screenshot',
  'ask.screenshotMax': 'Maximum {count} images attached',
  'ask.maxImages': 'Max {count} images',
  'ask.openHistory': 'Open history',
  'ask.openSettings': 'Open settings',
  'ask.attachedImages': 'Attached images',
  'ask.previewImage': 'Preview image',
  'ask.removeImage': 'Remove image',
  'ask.imageAlt': 'Attached',
  'ask.capturingScreen': 'Capturing screen...',
  'ask.commands': 'Commands',
  'ask.commandsLabel': 'Command suggestions',
  'ask.noCommands': 'No commands found',
  'ask.tabHint': 'Tab',

  // ─── Slash command descriptions ──────────────────────────────────────────
  'command.screen.desc': 'Capture your screen and include it as context',
  'command.do.desc': 'Agent mode: autonomously control your desktop',
  'command.think.desc': 'Think deeply before answering',
  'command.translate.desc': 'Translate text to another language',
  'command.rewrite.desc': 'Rewrite text for clarity and flow',
  'command.tldr.desc': 'Summarize text in 1-3 sentences',
  'command.refine.desc': 'Fix grammar, spelling, and punctuation',
  'command.bullets.desc': 'Extract key points as a bullet list',
  'command.todos.desc': 'Extract to-do items as a checkbox list',

  // ─── Message actions ─────────────────────────────────────────────────────
  'message.copy': 'Copy message',
  'message.copied': 'Copied',

  // ─── Thinking block ──────────────────────────────────────────────────────
  'thinking.label': 'Thinking...',
  'thinking.process': 'Thought process',
  'thinking.done': 'Done',
  'thinking.toggle': 'Toggle thinking details',

  // ─── Window controls ─────────────────────────────────────────────────────
  'window.save': 'Save conversation',
  'window.unsave': 'Remove from history',
  'window.saveTip': 'Save conversation (Ctrl+S)',
  'window.unsaveTip': 'Remove from history (Ctrl+S)',
  'window.new': 'New conversation',
  'window.newTip': 'New conversation (Ctrl+N)',
  'window.history': 'Open history',
  'window.historyTip': 'Conversation history (Ctrl+H)',
  'window.minimize': 'Minimize',
  'window.close': 'Close window',

  // ─── History panel ───────────────────────────────────────────────────────
  'history.search': 'Search past chats…',
  'history.today': 'Today',
  'history.yesterday': 'Yesterday',
  'history.earlier': 'Earlier',
  'history.loadError': "Couldn't load history — try again.",
  'history.empty': 'No conversations yet.',
  'history.new': '+ New conversation',
  'history.untitled': 'Untitled',
  'history.delete': 'Delete conversation',
  'history.switchTitle': 'Switch conversations?',
  'history.switchSave': 'Save & Switch',
  'history.switchJust': 'Just Switch',
  'history.newTitle': 'New conversation?',
  'history.newSave': 'Save & Start New',
  'history.newJust': 'Start New',

  // ─── Image preview ───────────────────────────────────────────────────────
  'imagePreview.label': 'Image preview',
  'imagePreview.alt': 'Preview',
  'imagePreview.close': 'Close preview',

  // ─── Loading ─────────────────────────────────────────────────────────────
  'typing.thinking': 'AI is thinking',

  // ─── Minibar ─────────────────────────────────────────────────────────────
  'minibar.title': 'QuickAI — click to restore, drag to move',

  // ─── Agent mode ──────────────────────────────────────────────────────────
  'agent.status.idle': 'Agent',
  'agent.status.capturing': 'Capturing screen...',
  'agent.status.analyzing': 'Analyzing...',
  'agent.status.executing': 'Executing action...',
  'agent.status.waitingConfirmation': 'Confirm action...',
  'agent.status.done': 'Done',
  'agent.status.error': 'Error',
  'agent.stop': 'Stop',
  'agent.confirmPrompt': 'Action requires confirmation:',
  'agent.allow': 'Allow',
  'agent.deny': 'Deny',
  'agent.action.click': 'Click ({x}, {y})',
  'agent.action.doubleClick': 'Double-click ({x}, {y})',
  'agent.action.rightClick': 'Right-click ({x}, {y})',
  'agent.action.drag': 'Drag ({x1}, {y1}) → ({x2}, {y2})',
  'agent.action.type': 'Type "{text}"',
  'agent.action.keyPress': 'Press {combo}',
  'agent.action.scroll': 'Scroll {direction} by {amount}',
  'agent.action.launch': 'Open {app}',
  'agent.action.listDir': 'List folder {path}',
  'agent.action.done': 'Finish',
  'agent.direction.up': 'up',
  'agent.direction.down': 'down',

  // ─── Error cards (ApiError.code → copy) ──────────────────────────────────
  'error.missingApiKey': 'No API key configured. Add one in Settings.',
  'error.missingModel': 'No chat model selected. Set one in Settings.',
  'error.unauthorized': 'Authentication failed. Check your API key.',
  'error.forbidden': 'The provider denied access to this model.',
  'error.rateLimited': 'Rate limit reached. Try again in a moment.',
  'error.serverError': 'The provider reported a server error. Try again.',
  'error.network': "Couldn't reach the provider. Check your connection.",
  'error.modelNotFound': 'Model not found. Pick another model in Settings.',
  'error.badRequest': 'The provider rejected the request.',
  'error.contextLengthExceeded': 'The conversation is too long for this model.',
  'error.cancelled': 'Cancelled.',
  'error.unknown': 'Something went wrong.',

  // ─── Desktop notification ────────────────────────────────────────────────
  'notify.title': 'QuickAI',
  'notify.body': 'Response ready',

  // ─── Tips ────────────────────────────────────────────────────────────────
  'tip.screen':
    'Use /screen to attach your display to the chat for visual context',
  'tip.quote':
    'Highlight text in any app before summoning QuickAI to include it as context',
  'tip.think':
    '/think makes QuickAI reason step by step before answering, great for hard questions',
  'tip.hide':
    'Ctrl+W or Esc hides the window; QuickAI keeps running in the background',
  'tip.dropImage':
    'Drop an image onto the bar to attach it and ask questions about what you see',
  'tip.pasteImage':
    'Paste images from your clipboard directly; no need to save to disk first',
  'tip.bookmark':
    'The bookmark icon saves the full conversation so you can come back to it later',
  'tip.translate':
    '/translate converts your selected text to any language you specify',
  'tip.history': 'Click the clock icon to browse all your past conversations',
  'tip.rewrite':
    'Highlight text and type /rewrite to get a cleaner, better-flowing version',
  'tip.tldr':
    '/tldr condenses any highlighted or pasted block of text into 1-3 sentences',
  'tip.refine':
    '/refine fixes grammar, spelling, and punctuation while keeping your voice',
  'tip.bullets':
    '/bullets turns highlighted text or a pasted block into a concise bullet list',
  'tip.todos':
    '/todos scans highlighted text and pulls out every action item as a checkbox list',
  'tip.slashCommands':
    'Type / in the ask bar to see all available commands and pick one with Tab',
  'tip.combine':
    'Commands can combine in one message: try /screen /think to capture and reason',
  'tip.cloud': 'Choose your chat provider and model in Settings → AI',
  'tip.imageLimit':
    'Attach images to your messages for visual context; visit Settings to adjust the limit',
  'tip.badge': 'TIP',
  'tip.openLink': 'Open tip link: {url}',

  // ─── Onboarding: intro ───────────────────────────────────────────────────
  'onboarding.intro.title': 'Before you dive in',
  'onboarding.intro.subtitle': "You'll get the hang of it quickly.",
  'onboarding.intro.summonPrefix': 'Double-tap',
  'onboarding.intro.summonSuffix': 'to summon',
  'onboarding.intro.summonDesc': 'Press Ctrl twice from any app, any time',
  'onboarding.intro.selectPrefix': 'Select text, then double-tap',
  'onboarding.intro.selectDesc':
    'It opens with your selection already quoted as context',
  'onboarding.intro.imageTitle': 'Drop in any image',
  'onboarding.intro.imageDesc':
    'Paste, drag, or clip a screenshot straight into the conversation.',
  'onboarding.intro.screenPrefix': 'Type',
  'onboarding.intro.screenSuffix': 'for context',
  'onboarding.intro.screenDesc':
    'Captures your display so QuickAI can see what you see',
  'onboarding.intro.floatTitle': 'Floats above everything',
  'onboarding.intro.floatDesc':
    'No app switching, no broken flow. Summon it, use it, and get straight back to work.',
  'onboarding.intro.getStarted': 'Get Started',
  'onboarding.intro.footer': 'Your API keys stay on this machine',

  // ─── Onboarding: permissions ─────────────────────────────────────────────
  'onboarding.permissions.title': "Let's get QuickAI set up",
  'onboarding.permissions.ready':
    "QuickAI doesn't need extra permissions on Windows.",
  'onboarding.permissions.hotkeyTitle': 'Activation hotkey',
  'onboarding.permissions.hotkeyDesc':
    'Double-tap Ctrl from any app to summon QuickAI',
  'onboarding.permissions.quitRelaunch': 'Quit & Reopen QuickAI',
  'onboarding.permissions.restartHint':
    'Restart to register the hotkey and finish setup',

  // ─── Settings window chrome ──────────────────────────────────────────────
  'settings.sections': 'Settings sections',
  'settings.close': 'Close settings',
  'settings.tab.ai': 'AI',
  'settings.tab.display': 'Display',
  'settings.tab.agent': 'Agent',
  'settings.tab.about': 'About',
  'settings.corruptPrefix': 'Your previous ',
  'settings.corruptMiddle': ' had a syntax error and was saved as ',
  'settings.corruptSuffix': '. Defaults are now active.',
  'settings.reveal': 'Reveal',
  'settings.dismiss': 'Dismiss',
  'settings.saved': 'Saved',
  'settings.fieldHelp': 'About {label}',
  'settings.decrease': 'Decrease',
  'settings.increase': 'Increase',
  'settings.section.provider': 'Provider',
  'settings.section.model': 'Model',
  'settings.section.connection': 'Connection',
  'settings.section.apiKey': 'API Key',
  'settings.section.window': 'Window',
  'settings.section.input': 'Input',
  'settings.section.language': 'Language',
  'settings.section.startup': 'Startup',
  'settings.section.file': 'File',
  'settings.section.danger': 'Danger zone',

  // ─── Settings: AI tab ────────────────────────────────────────────────────
  'settings.ai.provider': 'Chat provider',
  'settings.ai.model': 'Chat model',
  'settings.ai.modelPlaceholder': 'e.g. gpt-4o',
  'settings.ai.baseUrl': 'Base URL',
  'settings.ai.apiKey': 'API Key ({provider})',
  'settings.ai.apiKeyPlaceholder': 'Paste your API key',
  'settings.ai.apiKeyHelper':
    'Stored in the local database, never in config.toml.',

  // ─── Settings: Agent tab ─────────────────────────────────────────────────
  'settings.agent.provider': 'Agent provider',
  'settings.agent.model': 'Agent model',
  'settings.agent.modelPlaceholder': 'e.g. gpt-4o',

  // ─── Settings: Display tab ───────────────────────────────────────────────
  'settings.display.overlayWidth': 'Overlay width',
  'settings.display.maxChatHeight': 'Max chat height',
  'settings.display.maxImages': 'Max images',
  'settings.display.maxDisplayLines': 'Max display lines',
  'settings.display.maxDisplayChars': 'Max display chars',
  'settings.display.maxContextLength': 'Max context length',

  // ─── Settings: provider names ────────────────────────────────────────────
  'provider.openai': 'OpenAI',
  'provider.anthropic': 'Anthropic',
  'provider.openai_compatible': 'OpenAI-compatible (custom)',
  'language.en': 'English',
  'language.zh': '简体中文',

  // ─── Settings: About tab ─────────────────────────────────────────────────
  'about.tagline': 'A cloud-powered AI overlay for Windows.',
  'about.mantra': 'Bring your own key. No clutter. Just answers.',
  'about.versionLabel': 'View v{version} release notes on GitHub',
  'about.githubLabel': 'View QuickAI on GitHub',
  'about.feedbackLabel': 'Open an issue or share feedback on GitHub',
  'about.revealData': 'Reveal QuickAI app data',
  'about.refreshConfig': 'Refresh config.toml',
  'about.resetAll': 'Reset all to defaults...',
  'about.resetTitle': 'Reset all settings to defaults?',
  'about.resetMessage':
    'Your entire config.toml will be replaced with the defaults. This cannot be undone.',
  'about.resetConfirm': 'Reset all',
  'about.license': 'Apache-2.0 · Fork of thukiwin by ayzekhdawy',

  // ─── Settings: field helpers ─────────────────────────────────────────────
  'help.window.overlay_width':
    'How wide the floating QuickAI window is, in pixels. Raise for wider input and chat at the cost of more screen space.',
  'help.window.max_chat_height':
    'The largest the chat window can grow to as the conversation gets longer. Raise to see more history without scrolling.',
  'help.window.max_images':
    'How many images you can attach to a single message by pasting or dragging.',
  'help.quote.max_display_lines':
    'How many lines of the quoted text are shown as a preview in the input bar. The full text is still sent to the AI.',
  'help.quote.max_display_chars':
    'How many characters of the quoted text are shown as a preview in the input bar. The full text is still sent to the AI.',
  'help.quote.max_context_length':
    'How many characters of the quoted text are actually sent to the AI. Raise this if you quote long passages.',
  'help.chat.provider':
    'The cloud provider that answers your chat, vision and /think requests.',
  'help.chat.model':
    'The model used for chat. Pick a suggestion or type any model name your provider supports.',
  'help.chat.base_url':
    'The base URL for the chat provider. Leave empty to use the provider default. Required for OpenAI-compatible providers.',
  'help.agent.provider':
    'The cloud provider used when QuickAI controls your desktop with /do.',
  'help.agent.model':
    'The model used by agent mode. Pick a suggestion or type any model name your provider supports.',
  'help.agent.base_url':
    'The base URL for the agent provider. Leave empty to use the provider default. Required for OpenAI-compatible providers.',

  // ─── Settings: config errors ─────────────────────────────────────────────
  'configError.generic': "Couldn't save. Please try again.",
  'configError.ioError': "Couldn't save: {source}.",
  'configError.unknownSection': 'Unknown section: {section}.',
  'configError.unknownField': 'Unknown field: {section}.{key}.',
  'configError.typeMismatch': 'Wrong type for this field.',
  'configError.parse':
    'config.toml has a syntax error. Restart QuickAI to recover.',
  'configError.seedFailed': "Couldn't write defaults: {source}.",

  // ─── Batch 2: chat & agent UX (T6) ──────────────────────────────────────
  'window.pin': 'Pin window',
  'window.unpin': 'Unpin window',
  'window.pinTip': 'Keep the window open when you click away',
  'window.unpinTip': 'Let the window hide when you click away',
  'conversation.rename': 'Rename conversation',
  'conversation.renameLabel': 'Conversation name',
  'history.rename': 'Rename',
  'history.renameError': "Couldn't rename — try again.",
  'history.deleteConfirmTitle': 'Delete conversation?',
  'history.deleteAction': 'Delete',
  'agent.dismiss': 'Dismiss',
  'agent.keyboardHint':
    '←/→ to select, Enter to confirm, 1 allow, 2 deny, Ctrl+C to abort',

  // ─── Batch 2: settings General / Agent / About (T5) ─────────────────────
  'settings.tab.general': 'General',
  'settings.section.hotkey': 'Hotkey',
  'settings.section.data': 'Data',
  'settings.section.agentMode': 'Agent mode',
  'settings.section.permissions': 'Permissions',
  'settings.section.shortcuts': 'Shortcuts and commands',
  'settings.section.help': 'Help',
  'settings.general.hotkey': 'Summon hotkey',
  'settings.general.language': 'Interface language',
  'settings.general.dataDir': 'Data directory',
  'settings.general.dataDirPlaceholder': 'Default location',
  'settings.general.dataDirNote':
    'A restart is required for changes to take effect.',
  'settings.general.startOnBoot': 'Start on boot',
  'settings.general.startOnBootError':
    "Couldn't update the start-on-boot setting.",
  'hotkey.ctrl': 'Ctrl',
  'hotkey.alt': 'Alt',
  'hotkey.shift': 'Shift',
  'hotkey.win': 'Windows',
  'language.auto': 'Auto (system)',
  'help.general.hotkey':
    'The key you double-tap to summon QuickAI from any app. Pick one that does not clash with your other shortcuts.',
  'help.general.language':
    'The interface language. Auto follows your Windows display language.',
  'help.general.data_dir':
    'Where QuickAI keeps its database and saved images. Leave empty to use the default app data folder. A restart is required.',
  'settings.agent.mode': 'Configuration',
  'agent.mode.sameAsChat': 'Same as AI configuration',
  'agent.mode.custom': 'Custom',
  'settings.agent.usesChat': 'Uses your AI configuration',
  'settings.agent.noModel': 'No model set',
  'settings.agent.permission': 'Agent permissions',
  'agent.permission.limited': 'Limited — ask before dangerous actions',
  'agent.permission.full': 'Full — unrestricted control',
  'settings.agent.permissionWarning':
    'Full control lets the agent run any action on your computer without asking for confirmation.',
  'help.agent.mode':
    'Whether agent mode reuses your AI configuration, or uses its own provider, model, base URL and API key.',
  'help.agent.permission':
    'Limited runs safe actions automatically and asks before anything dangerous. Full never asks — the agent may act freely on your computer.',
  'about.shortcut.summon': 'Summon QuickAI from any app',
  'about.keys.summon': 'Double-tap {key}',
  'about.shortcut.save': 'Save or unsave the conversation',
  'about.keys.save': 'Ctrl+S',
  'about.shortcut.new': 'Start a new conversation',
  'about.keys.new': 'Ctrl+N',
  'about.shortcut.history': 'Open conversation history',
  'about.keys.history': 'Ctrl+H',
  'about.shortcut.copy': 'Copy the last response',
  'about.keys.copy': 'Ctrl+Shift+C',
  'about.shortcut.hide': 'Hide the window',
  'about.keys.hide': 'Esc / Ctrl+W',
  'about.shortcut.scroll': 'Jump to the top or bottom of the chat',
  'about.keys.scroll': 'Ctrl+Home / Ctrl+End',
  'about.shortcut.settings': 'Open Settings',
  'about.keys.settings': 'Ctrl+,',
  'about.shortcut.closeSettings': 'Close Settings from inside the window',
  'about.keys.closeSettings': 'Ctrl+W',
  'about.shortcut.agentAllow': 'Agent: allow the pending action',
  'about.keys.agentAllow': '1',
  'about.shortcut.agentDeny': 'Agent: deny the pending action',
  'about.keys.agentDeny': '2',
  'about.shortcut.agentAbort': 'Agent: abort the run',
  'about.keys.agentAbort': 'Ctrl+C',
  'about.commandsIntro':
    'Type / in the ask bar to see these commands, then pick one with Tab.',
  'about.help.featuresTitle': 'Features',
  'about.help.features':
    'QuickAI floats above your other windows as a fast AI assistant. Chat with OpenAI, Anthropic, or any OpenAI-compatible model; attach screenshots or images for visual context; use slash commands to capture the screen, translate, rewrite, summarize, or extract to-dos; let /do agent mode control your desktop; and browse saved conversations from the history panel. The interface speaks English and Simplified Chinese.',
  'about.help.usageTitle': 'Usage',
  'about.help.usage':
    'Double-tap {key} anywhere to summon QuickAI. Type your question and press Enter, or attach text and images first. Add a slash command for special tasks. Press Ctrl+S to save the conversation to history, and Ctrl+W or Esc to hide the window — QuickAI keeps running in the background.',
  'about.help.trayTitle': 'Tray icon',
  'about.help.tray':
    'QuickAI lives in the system tray. The tray icon always shows the QuickAI logo — it has no separate states while the app runs. Left-click it to open its menu (Open QuickAI, Quit); right-click it to show or hide the overlay.',

  // ─── Batch 3: settings theme, data dir, skills, About popups (T11) ──────
  'common.close': 'Close',
  'settings.section.appearance': 'Appearance',
  'settings.general.theme': 'Theme',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'help.general.theme':
    'The color scheme for QuickAI. Dark is the default; light is easier on the eyes in a bright room.',
  'hotkey.doubleTap': 'Double-tap {key}',
  'settings.general.dataDirBrowse': 'Browse…',
  'settings.general.dataDirDefault': 'Default: {path}',
  'settings.section.skills': 'Skills',
  'settings.skills.alias': 'Alias',
  'settings.skills.aliasPlaceholder': 'e.g. translate',
  'settings.skills.path': 'Path',
  'settings.skills.pathPlaceholder': 'Path to the skill file',
  'settings.skills.add': 'Add skill',
  'settings.skills.edit': 'Edit skill',
  'settings.skills.delete': 'Delete skill',
  'settings.skills.save': 'Save',
  'settings.skills.moveUp': 'Move up',
  'settings.skills.moveDown': 'Move down',
  'settings.skills.enabledFor': 'Use {alias} as a system prompt',
  'settings.skills.builtin': 'Built-in',
  'settings.skills.empty': 'No skills yet.',
  'settings.skills.loadError': "Couldn't load skills.",
  'settings.skills.saveError': "Couldn't save skills. Please try again.",
  'settings.skills.errorAliasEmpty': 'Enter an alias.',
  'settings.skills.errorAliasWhitespace': 'The alias cannot contain spaces.',
  'settings.skills.errorAliasDuplicate': 'That alias is already in use.',

  // ─── Batch 3: chat & agent UX (T12) ─────────────────────────────────────
  'command.add.desc': 'Add a skill to this message',
  'ask.skills': 'Skills',
  'ask.skillPickerLabel': 'Skill suggestions',
  'ask.noSkills': 'No skills configured',
  'ask.skillAddHint': 'Ctrl+Enter',
  'ask.skillEnabledHint': 'Already enabled',
  'ask.selectedSkills': 'Selected skills',
  'ask.removeSkill': 'Remove skill {alias}',
  'error.skillUnreadable':
    "A selected skill couldn't be read, so it was left out of this message.",

  // ─── Batch 4: settings skills + connection test (T33) ───────────────────
  'settings.skills.enableHint':
    'Enabled skills are added to the system prompt on every turn. Disabled ones are used only when you name them with /add.',
  'settings.skills.errorPathEmpty': 'Enter a path for this skill.',
  'settings.skills.errorPathNotAFile':
    'That path is a folder. Choose a file, not a folder.',
  'settings.skills.errorUnsupportedFormat':
    'Unsupported file type ({extension}). Only .txt and .md files are allowed.',
  'settings.skills.errorUnsupportedFormatNoExt':
    'Only .txt and .md skill files are allowed.',
  'settings.skills.errorStrayQuote':
    'The path still starts or ends with a quote character.',
  'settings.skills.errorBuiltinNotDeletable':
    'The built-in skill cannot be deleted.',
  'settings.connection.status': 'Connection status',
  'settings.connection.untested': 'Not yet tested',
  'settings.connection.testing': 'Testing…',
  'settings.connection.ok': 'Connected',
  'settings.connection.test': 'Test connection',
  'error.unsupportedCapability':
    'The provider rejected the request: this model or endpoint does not support the capability QuickAI needs.',
} as const;

/** The complete set of translation keys understood by the app. */
export type TranslationKey = keyof typeof en;
