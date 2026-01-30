---
name: local-deploy
description: Build the plugin and deploy it to a local Obsidian vault for testing.
disable-model-invocation: true
allowed-tools: Bash(npm*), Bash(node*), Bash(npx*), Bash(mkdir*), Bash(cp*), Read, Glob
---

Deploy **obsidian-notion-freeze** to the local Obsidian vault for testing. Do NOT build first — just copy the already-built files.

## Target

`D:/GitHub/ran-work/.obsidian/plugins/obsidian-notion-freeze/`

## Steps

1. **Create the plugin directory** if it doesn't exist.

2. **Copy these files** into the target directory:
   - `main.js`
   - `manifest.json`

3. **Report success** and remind the user to reload Obsidian (Ctrl+R) or toggle the plugin off/on in Settings.
