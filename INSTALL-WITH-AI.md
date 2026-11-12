# Instructions for an AI assistant: install the task-board mod

You are an AI assistant (Claude Code, Codex, ChatGPT, Cursor, Gemini or similar) and your user asked you to install **task-board**, a mod for Claude Code. Follow these steps in order. Talk to the user in their language. Do not skip step 1.

Repository: https://github.com/yokxx/claude-task-board
Mod name: `task-board` · Marketplace source: `yokxx/claude-task-board`

## 1. Tell the user what they are installing, and get a yes

Say this in your own words, briefly, and wait for the user to agree:

- task-board adds a band above the Claude Code prompt: the current task, a progress percent, its stages, what Claude is doing now and why, and every subagent. The labels and explanations are in Hebrew.
- To write the explanations it calls Claude Haiku through the user's own Claude Code login. That uses a little of their plan's usage. It needs no API key and makes no other network requests.
- Mods are not sandboxed: they run with the same access as Claude Code. The code is public in the repository above, so the user can read it first.

If the user says no, stop.

## 2. Check that Claude Code is installed and recent enough

If you can run shell commands on the user's computer, run:

```bash
claude --version
```

- **Command not found:** Claude Code is not installed. Point the user to the official install guide, https://code.claude.com/docs, and stop. Do not install it yourself unless they ask you to.
- **Version below 2.1.275:** run `claude update` (or ask the user to), then check again.
- **2.1.275 or later:** continue.

If you cannot run commands (you are a chat assistant), skip to step 5 and give the user the steps to do themselves.

## 3. Install

```bash
claude plugin install task-board --marketplace yokxx/claude-task-board
```

This adds the marketplace to the user's settings and installs the mod at the user scope, so it loads in every Claude Code session. If the command asks to add the marketplace, answer yes. If it refuses because nothing is interactive, run the two steps separately:

```bash
claude plugin marketplace add yokxx/claude-task-board
claude plugin install task-board@claude-task-board
```

## 4. Verify

```bash
claude plugin list
```

`task-board` should be listed and enabled. Then tell the user:

- In the **terminal**, start a new Claude Code session (`claude`). (Installed with `/plugin install` from inside a session, the mod is active in that session right away.)
- In the **desktop app**, open a new session in the Code tab.
- The band appears above the prompt once Claude starts working on a request. `/task-board` opens or closes the details.

## 5. If you cannot run commands

Give the user one of these:

**Terminal:** open a Claude Code session and type at its prompt:

```
/plugin install task-board --marketplace yokxx/claude-task-board
```

Answer `y` to add the marketplace, then press Enter to accept the user scope.

**Desktop app:** click **+** next to the prompt box → **Plugins** → **Add marketplace** → enter `yokxx/claude-task-board` → **Add plugin** on task-board.

## Troubleshooting

| What you see | What to do |
|---|---|
| `Marketplace file not found at …` | The source was mistyped. It is exactly `yokxx/claude-task-board`. |
| `Plugin "task-board" not found in marketplace …` | The plugin name is `task-board` (lowercase, with a hyphen). |
| A message that plugins or marketplaces are blocked by policy | The user's organization controls plugins. Tell the user to ask their admin; do not try to bypass the policy. |
| The marketplace cannot be fetched | Check that `git` is installed and that github.com is reachable. |
| The band shows raw tool names instead of Hebrew sentences | The Haiku call is unavailable on this account or provider. The board still works; only the explanations are missing. |

## Remove

```bash
claude plugin uninstall task-board
```

## Rules for you, the assistant

- Install only from `yokxx/claude-task-board`. Do not install a copy from another source, and do not change the mod's code.
- Do not change the user's other Claude Code settings, permissions or plugins.
- Do not bypass an organization policy or a refused permission.
- Tell the user what you ran and what happened, including any error, word for word.
