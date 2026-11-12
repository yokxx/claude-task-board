# task-board: a Claude Code mod

A band above the Claude Code prompt that shows what Claude is doing right now and how far along it is.

- **Collapsed:** the current task, a progress bar with a percent, how many stages are left, and how many subagents are running.
- **Details ▾:** the goal, what Claude is doing *now*, every stage of the work (✓ done, ◐ in progress, ○ pending) with its own bar, and per stage the steps Claude took, each with one sentence on **what it does and why**. Hover a step for more.
- **Subagents:** each subagent Claude starts gets its own row: running, queued or done, its own bar, its working time and what it is doing now. Click one to see its stages.
- `/task-board` opens or closes the details.

Stages come from the plan Claude keeps (the desktop app's task list, `TodoWrite`, or `TaskCreate`/`TaskUpdate`). When there is no plan, a small model infers the stages. The explanations and labels are **in Hebrew**.

## Install

Requires Claude Code **2.1.275 or later** (`claude --version`; tested on 2.1.321).

At the prompt of a Claude Code terminal session:

```
/plugin install task-board --marketplace yokxx/claude-task-board
```

Answer `y` to add the marketplace, then press Enter for the user scope. The band appears in that session and in every session after it.

From a shell:

```bash
claude plugin install task-board --marketplace yokxx/claude-task-board
```

In the desktop app (where `/plugin` does not run): click **+** next to the prompt box → **Plugins** → **Add marketplace** with `yokxx/claude-task-board` → **Add plugin**. A mod installed from a terminal at the user scope also loads in the desktop app's Code tab.

Installing with an AI assistant? Give it [INSTALL-WITH-AI.md](INSTALL-WITH-AI.md).

## Remove

```bash
claude plugin uninstall task-board
```

## What it does with your data and your usage

- **It uses your own Claude account for the explanations.** After every few tool calls the mod asks Claude Haiku, through Claude Code's own model client (the same login and plan as your session), to write the one-line explanations. That is a small extra cost against your usage. No API key and no outside service are involved.
- **What that call sees:** your request, Claude's plan, the last part of Claude's reply, and the names and inputs of the tool calls being explained. It goes to Anthropic under your account, like the rest of the session.
- **Nothing else leaves your machine.** The mod makes no network requests of its own and writes no files.
- **Mods are not sandboxed.** Like any mod, this one runs with the same access as Claude Code. Read the code before you install it (about 1,550 lines in `hooks/`).

## Files

| Path | What it is |
|---|---|
| `.claude-plugin/plugin.json` | the mod's manifest |
| `.claude-plugin/marketplace.json` | makes this repository installable with one line |
| `hooks/register.tsx` | the hooks: tasks, steps, subagents, and the band it draws |
| `hooks/board.ts` | the board's data model and progress math |
| `hooks/explain.ts` | the explainer: batches finished steps and asks Haiku for a sentence each |
| `types/index.d.ts` | the mod's state contract |
| `tests/` | `claude plugin test .` runs them |

## Guides

- [Install guide, step by step (Hebrew)](GUIDE.he.md)
- [How Claude Code mods work, and how to build one (Hebrew)](docs/MODS-GUIDE.he.md)
- [Instructions for an AI assistant that installs this mod](INSTALL-WITH-AI.md)

## License

MIT

---

## בעברית

מוד ל־Claude Code שמוסיף פס מעל שורת ההקלדה: המשימה הנוכחית, כמה אחוז ממנה הושלם, השלבים, ומה Claude עושה בכל שלב ולמה. אם Claude מפעיל סוכני משנה, רואים גם אותם. ההסברים בעברית.

**התקנה** (בתוך סשן של Claude Code בטרמינל):

```
/plugin install task-board --marketplace yokxx/claude-task-board
```

עונים `y`, ואז Enter.

**מדריך התקנה מלא, צעד אחר צעד:** [GUIDE.he.md](GUIDE.he.md)

**רוצים שה־AI שלכם יתקין?** תדביקו לו: "תתקין לי את המוד לפי ההוראות כאן: https://github.com/yokxx/claude-task-board/blob/main/INSTALL-WITH-AI.md"

מדריך מלא על מודים ואיך בונים אחד: [docs/MODS-GUIDE.he.md](docs/MODS-GUIDE.he.md).
