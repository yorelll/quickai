# Security Policy

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/yorelll/quickai/security/advisories/new).
This keeps the details confidential until a fix is ready.

We will acknowledge your report within **48 hours** and aim to release a fix
within **14 days** for critical issues, depending on severity and complexity.

## Scope

QuickAI runs entirely on your local machine and has no first-party server
component. Its only outbound network traffic is the requests it makes to the AI
provider you configure. The attack surface is limited to:

- The Tauri IPC boundary between the frontend and the Rust backend
- The Windows keyboard hook and clipboard simulation used for context capture
  (`windows_activator.rs`)
- Screen capture via GDI `BitBlt` through the Tauri command layer
  (`windows_screenshot.rs`)
- The local SQLite database storing conversation history and API keys
- Outbound HTTPS calls to the configured AI provider (OpenAI, Anthropic, or an
  OpenAI-compatible endpoint) and the handling of provider responses
- Image processing via the `image` crate

## Supported Versions

We support the latest release only. Please verify you are on the latest version
before reporting.
