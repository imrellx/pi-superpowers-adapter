# pi-superpowers-adapter

Thin Pi adapter for upstream [obra/superpowers](https://github.com/obra/superpowers).

This package only makes Superpowers work in Pi as close as possible to the upstream author's intended behavior. It does not install, fork, vendor, or modify Superpowers. It does not install, fork, vendor, or modify Nico Bailon's `pi-subagents`.

## Install

Install the upstream packages explicitly:

```bash
pi install https://github.com/obra/superpowers
pi install npm:pi-subagents
pi install git:github.com/imrellx/pi-superpowers-adapter
```

For local development:

```bash
pi install /absolute/path/to/pi-superpowers-adapter
```

## What this adapter provides

- `Skill` tool for Superpowers skill loading
- `TodoWrite` tool for Superpowers checklist tracking
- `Task` tool for Superpowers `Task tool (general-purpose)` prompts
- automatic `using-superpowers` bootstrap injection on each agent start

`Task` maps Superpowers `general-purpose` to Nico `pi-subagents` agent `worker` through Nico's `subagent` event bridge.

## Non-goals

This is not a generic Claude Code compatibility layer. It does not provide tintinweb-style `Agent`, `get_subagent_result`, or `steer_subagent` tools because upstream Superpowers does not require them.

## Verification

Run local checks:

```bash
npm run verify
```

Manual Superpowers acceptance test:

1. Start a clean Pi session with Superpowers, Nico `pi-subagents`, and this adapter installed.
2. Send exactly:

```text
Let's make a react todo list
```

Expected behavior: Pi invokes `Skill({ skill: "brainstorming" })` before writing code.

## Missing dependency behavior

If Superpowers is not installed, bootstrap and `Skill` lookup report:

```bash
pi install https://github.com/obra/superpowers
```

If Nico `pi-subagents` is not installed or active, `Task` reports:

```bash
pi install npm:pi-subagents
```

## Tool name conflicts

If Pi reports `Tool "Skill" conflicts`, `Tool "TodoWrite" conflicts`, or `Tool "Task" conflicts`, another Superpowers compatibility package is already installed. Disable or remove the duplicate package. For local smoke tests, run with `--no-extensions -e .` so only this adapter loads.
