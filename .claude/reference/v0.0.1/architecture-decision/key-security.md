# ADR: API Key Storage Security

**Status:** Decided — keep plaintext in `data.json`
**Date:** 2026-01-30

## Context

The plugin requires a Notion API integration token (`ntn_...`) to make API calls. Currently the key is stored as plaintext in `data.json` via Obsidian's `loadData()`/`saveData()` API. This file lives at `.obsidian/plugins/obsidian-notion-freeze/data.json` inside the user's vault.

The key is entered in the settings tab (masked as a password input) and passed to `@notionhq/client` as the `auth` parameter.

### Concerns

- `data.json` is synced by Obsidian Sync by default (unless users disable "Installed community plugins" in sync settings)
- Users who version-control their vault with git may commit the key
- The key sits unencrypted on disk

## Options Evaluated

### 1. Plaintext in `data.json` (current approach)
- Standard pattern used by virtually all Obsidian plugins that need API keys
- Works seamlessly across devices via Obsidian Sync
- Key is readable on disk by anything with filesystem access

### 2. Electron `safeStorage` API
- Uses OS-level encryption (Windows DPAPI, macOS Keychain, Linux Secret Service)
- Zero dependencies — Electron runtime already provides it
- **Problem:** Encryption is tied to the OS user account on a specific machine. The encrypted blob is undecryptable on other devices. Combined with Obsidian Sync this creates a destructive loop:
  - Computer A encrypts → blob A syncs to Computer B
  - Computer B can't decrypt → user re-enters key → blob B syncs back
  - Computer A can't decrypt blob B → cycle repeats
- Only viable for single-machine use or if plugin settings sync is disabled

### 3. Environment variables
- Key stays out of the vault entirely
- Poor UX: users must set env vars before launching Obsidian
- Not portable across machines without separate config management

### 4. Prompt every session (no persistence)
- Most secure — key only exists in memory
- Worst UX — must re-enter on every Obsidian launch

## Decision

Keep plaintext storage in `data.json`. Rationale:

1. **Multi-device sync compatibility** is a hard requirement. `safeStorage` breaks this.
2. **Threat model doesn't justify the UX cost.** If an attacker has filesystem access to the vault, the API key is the least of the user's concerns — all their notes are already exposed.
3. **The credential is low-risk.** Notion integration tokens are scoped to specific pages/databases, easily rotatable, and not passwords.
4. **This is the ecosystem norm.** Every Obsidian plugin storing API keys (Readwise, Templater, various AI plugins) uses the same `data.json` approach.

## Mitigations

- The settings input field uses `type="password"` to prevent casual shoulder-surfing
- Users are responsible for their vault's filesystem permissions and sync configuration
- Notion tokens are scoped and revocable at notion.so/profile/integrations
