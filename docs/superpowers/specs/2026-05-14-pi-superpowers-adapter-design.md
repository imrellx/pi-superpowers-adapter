# Pi Superpowers Adapter Design

Date: 2026-05-14

## Purpose

This repository provides a thin Pi adapter for upstream `obra/superpowers`.

Its only job is to make Superpowers work in Pi as close as possible to the author's intended behavior in supported harnesses such as Claude Code, Codex, OpenCode, Gemini, Cursor, and Copilot.

The adapter does not replace, fork, vendor, or modify Superpowers. It does not replace, fork, vendor, or modify Nico Bailon's `pi-subagents`. It only supplies the Pi compatibility surface Superpowers expects.

## Upstream Evidence

### Superpowers expects automatic bootstrap

`obra/superpowers` includes harness-specific bootstrap mechanisms:

- Claude/plugin hook files under `.claude-plugin/` and `hooks/session-start`
- Codex plugin metadata under `.codex-plugin/plugin.json`
- OpenCode plugin injection in `.opencode/plugins/superpowers.js`
- Gemini extension metadata in `gemini-extension.json` and `GEMINI.md`
- Cursor and Copilot plugin metadata

The upstream contribution guidance says a real new harness integration must load the `using-superpowers` bootstrap at session start and pass the acceptance test where `"Let's make a react todo list"` triggers `brainstorming` before code is written.

### Superpowers expects a `Skill` tool

`skills/using-superpowers/SKILL.md` says skills must be invoked before any response/action when applicable and specifically describes using the `Skill` tool. It also says not to read skill files directly.

### Superpowers expects `TodoWrite`

`skills/using-superpowers/SKILL.md` directs agents to create `TodoWrite` tasks when a loaded skill has a checklist. Other Superpowers skills also rely on todo tracking during plan execution.

### Superpowers expects `Task tool (general-purpose)` for subagents

Observed Superpowers prompt templates use `Task tool (general-purpose)`:

- `skills/subagent-driven-development/implementer-prompt.md`
- `skills/subagent-driven-development/spec-reviewer-prompt.md`
- `skills/subagent-driven-development/code-quality-reviewer-prompt.md`
- `skills/requesting-code-review/code-reviewer.md`
- `skills/brainstorming/spec-document-reviewer-prompt.md`
- `skills/writing-plans/plan-document-reviewer-prompt.md`

Search evidence found no Superpowers source dependency on tintinweb-specific tools such as `Agent`, `get_subagent_result`, or `steer_subagent`.

### Nico `pi-subagents` is the selected subagent backend

Nico Bailon's `pi-subagents` is current Pi-native and uses current `@earendil-works/*` package names. It registers a `subagent` tool and provides built-in agents including `worker`, `reviewer`, `planner`, `scout`, `researcher`, `context-builder`, `oracle`, and `delegate`.

The adapter maps Superpowers' `Task` requirement to Nico's `subagent` implementation.

## Package Scope

The adapter is a standalone Pi package with one extension entry.

Installation is explicit and manual:

```bash
pi install https://github.com/obra/superpowers
pi install npm:pi-subagents
pi install <this-adapter>
```

The adapter does not perform installation of upstream packages.

## Compatibility Contract

Every adapter feature must trace to a Superpowers requirement.

The adapter provides exactly four compatibility behaviors:

1. Bootstrap `using-superpowers` automatically.
2. Register `Skill` tool.
3. Register `TodoWrite` tool.
4. Register `Task` tool backed by Nico `pi-subagents`.

No other compatibility surface is included unless future source evidence from Superpowers requires it.

## Tool Surface

### `Skill`

Loads a skill by name.

Input:

```ts
{ skill: string }
```

Behavior:

- discovers installed skills
- locates matching `SKILL.md`
- strips frontmatter
- returns full skill body to the model
- includes metadata such as skill name/path in details
- clears cache on resource reload/session resource discovery

Rationale: Superpowers explicitly requires a `Skill` tool and instructs agents not to read skill files directly.

### `TodoWrite`

Tracks current session tasks.

Input:

```ts
{
  todos: Array<{
    id: string
    content: string
    status: "pending" | "in_progress" | "completed"
    priority?: "high" | "medium" | "low"
  }>
}
```

Behavior:

- replaces current todo list with provided list
- stores todos in memory for current session
- clears todos on `session_start`
- returns formatted list and completion count

Rationale: Superpowers checklists expect todo tracking.

### `Task`

Dispatches a Superpowers-style subagent task through Nico `pi-subagents`.

Input:

```ts
{
  subagent_type: string
  prompt: string
  description: string
  model?: string
  thinking?: string
  max_turns?: number
  run_in_background?: boolean
  resume?: string
  isolated?: boolean
  inherit_context?: boolean
}
```

Supported v1 behavior:

- accepts `subagent_type: "general-purpose"`
- maps `general-purpose` to Nico agent `worker`
- maps `prompt` to Nico `task`
- maps `model` if Nico accepts model override
- maps `run_in_background` to Nico `async`
- maps `inherit_context: true` to Nico `context: "fork"`
- maps omitted/false `inherit_context` to Nico `context: "fresh"`
- reports unsupported fields explicitly in result warnings

Unsupported v1 behavior:

- unknown `subagent_type` values fail loudly
- `isolated`, `resume`, `thinking`, and `max_turns` are forwarded only if confirmed supported by Nico's schema; otherwise result includes a warning

Rationale: Superpowers uses `Task tool (general-purpose)` in its subagent templates. Nico's `worker` has implementation-capable tool access and can still act as reviewer because the Superpowers prompt defines the role.

## Bootstrap Behavior

On `before_agent_start`, the adapter:

1. locates `using-superpowers/SKILL.md`
2. strips frontmatter
3. appends the content to Pi's system prompt inside a clearly marked block
4. includes Pi-specific tool mapping notes:
   - `Skill` -> adapter `Skill`
   - `TodoWrite` -> adapter `TodoWrite`
   - `Task` -> adapter `Task`, backed by Nico `pi-subagents`
   - file and shell tools use Pi names: `read`, `bash`, `edit`, `write`

The adapter caches discovered skill metadata and invalidates cache on resource discovery/reload.

## Skill Discovery

The adapter searches Pi and Agent Skills locations compatible with Pi's documented skill behavior and common package installs:

- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `.pi/skills/` in the current project
- `.agents/skills/` in the current project
- package-installed skill directories discoverable under Pi package locations, including Superpowers installed from GitHub

The implementation should prefer Pi-provided resource discovery where possible and use filesystem scanning only for the `Skill` tool and bootstrap lookup.

## Non-Goals

Version 1 does not include:

- meta-installer
- doctor command
- bundled Superpowers
- bundled Nico `pi-subagents`
- modifications to upstream Superpowers skills
- modifications to upstream Nico `pi-subagents`
- tintinweb API emulation (`Agent`, `get_subagent_result`, `steer_subagent`)
- additional workflow skills or opinions
- broad Claude Code compatibility beyond what Superpowers itself needs

## Error Behavior

The adapter fails loudly when required upstream pieces are missing.

If `using-superpowers` is not found:

- do not fake bootstrap
- warn that Superpowers must be installed:

```bash
pi install https://github.com/obra/superpowers
```

If `Task` is called and Nico `subagent` backend is unavailable:

- return an error result
- include install instruction:

```bash
pi install npm:pi-subagents
```

If unsupported `Task` parameters are passed:

- execute supported behavior only when safe
- include explicit warnings in the result

If `subagent_type` is not `general-purpose`:

- fail loudly
- do not guess an agent mapping

## Verification Plan

The adapter is complete only when it proves Superpowers behavior, not merely compilation.

### 1. Bootstrap acceptance

Clean Pi session with Superpowers, Nico `pi-subagents`, and adapter installed.

User prompt:

```text
Let's make a react todo list
```

Expected behavior: model invokes `Skill({ skill: "brainstorming" })` before writing code.

This mirrors Superpowers' upstream new-harness acceptance test.

### 2. Skill tool

Call:

```ts
Skill({ skill: "brainstorming" })
```

Expected behavior: returns full brainstorming skill body, frontmatter stripped.

### 3. TodoWrite

Call `TodoWrite` with pending/in-progress/completed todos.

Expected behavior: formatted todo list with correct completion count.

### 4. Task bridge

Call:

```ts
Task({
  subagent_type: "general-purpose",
  description: "Review test",
  prompt: "Read README and summarize"
})
```

Expected behavior: dispatches Nico `worker` through `subagent` and returns the child result or async handle according to `run_in_background`.

### 5. Missing dependency failures

- Without Superpowers: bootstrap/Skill lookup warns with Superpowers install command.
- Without Nico `pi-subagents`: `Task` returns error with `pi install npm:pi-subagents`.

## Design Decision Summary

The adapter follows Option A: thin adapter only.

It intentionally limits scope to Superpowers' observed requirements: bootstrap, `Skill`, `TodoWrite`, and `Task`. Nico `pi-subagents` remains an implementation detail. Extra compatibility tools are excluded until Superpowers source evidence requires them.
