# Pi Superpowers Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin Pi package that makes upstream `obra/superpowers` work in Pi by providing bootstrap injection plus `Skill`, `TodoWrite`, and `Task` compatibility tools backed by Nico Bailon's `pi-subagents`.

**Architecture:** The adapter is one Pi extension split into focused modules: schemas, todo tool, skill discovery/Skill tool/bootstrap lookup, and Task-to-Nico bridge. It does not install or vendor upstream packages. `Task` dispatch uses Nico `pi-subagents`' existing event bridge (`subagent:slash:request` -> `subagent:slash:response`) because Pi ExtensionAPI exposes no public cross-extension tool execution method.

**Tech Stack:** TypeScript Pi extension, `@earendil-works/pi-coding-agent` extension API, `typebox` schemas, Node 25 built-in test runner, TypeScript typecheck.

---

## File Structure

- Create `package.json` — Pi package manifest, scripts, peer/dev dependencies.
- Create `tsconfig.json` — strict TypeScript config for source and tests.
- Create `src/schemas.ts` — TypeBox schemas and exported TypeScript types for `Skill`, `TodoWrite`, and `Task` inputs.
- Create `src/todos.ts` — session-scoped todo state and `TodoWrite` tool registration.
- Create `src/skills.ts` — skill discovery, frontmatter stripping, bootstrap lookup, and `Skill` tool registration.
- Create `src/task-bridge.ts` — Superpowers `Task` tool registration and Nico event bridge invocation.
- Create `src/index.ts` — extension entrypoint that wires all modules and lifecycle hooks.
- Create `test/fakes.ts` — fake Pi API and event bus for unit tests.
- Create `test/todos.test.ts` — TodoWrite behavior tests.
- Create `test/skills.test.ts` — skill discovery/frontmatter/Skill tool tests.
- Create `test/bootstrap.test.ts` — `using-superpowers` injection tests.
- Create `test/task-bridge.test.ts` — Task mapping, missing dependency, timeout, cancellation tests.
- Create `test/package.test.ts` — package manifest sanity tests.
- Create `README.md` — install order, scope, behavior, and manual acceptance test.

---

### Task 1: Scaffold Pi package and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/schemas.ts`
- Create: `test/fakes.ts`
- Create: `test/package.test.ts`

- [ ] **Step 1: Create package manifest**

Create `package.json`:

```json
{
  "name": "pi-superpowers-adapter",
  "version": "0.1.0",
  "description": "Thin Pi adapter for upstream obra/superpowers compatibility",
  "type": "module",
  "license": "MIT",
  "keywords": ["pi-package", "pi", "superpowers", "adapter"],
  "files": ["src/", "README.md"],
  "scripts": {
    "test": "node --experimental-strip-types --test test/*.test.ts",
    "typecheck": "tsc --noEmit",
    "verify": "npm run typecheck && npm test"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.74.0",
    "@types/node": "^25.7.0",
    "typebox": "^1.1.38",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Define shared schemas**

Create `src/schemas.ts`:

```ts
import { Type, type Static } from "typebox";

export const TodoStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
]);

export const TodoPrioritySchema = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
]);

export const TodoWriteSchema = Type.Object({
  todos: Type.Array(Type.Object({
    id: Type.String({ description: "Unique identifier for the todo item" }),
    content: Type.String({ description: "The content/description of the todo item" }),
    status: TodoStatusSchema,
    priority: Type.Optional(TodoPrioritySchema),
  })),
});

export type TodoWriteInput = Static<typeof TodoWriteSchema>;
export type TodoStatus = Static<typeof TodoStatusSchema>;
export type TodoPriority = Static<typeof TodoPrioritySchema>;
export type TodoItem = TodoWriteInput["todos"][number];

export const SkillSchema = Type.Object({
  skill: Type.String({ description: "Name of the skill to load, for example brainstorming" }),
});

export type SkillInput = Static<typeof SkillSchema>;

export const TaskSchema = Type.Object({
  subagent_type: Type.String({ description: "Superpowers subagent type. v1 supports general-purpose." }),
  prompt: Type.String({ description: "Task prompt for the subagent" }),
  description: Type.String({ description: "Short task description" }),
  model: Type.Optional(Type.String({ description: "Optional model override forwarded to Nico pi-subagents" })),
  thinking: Type.Optional(Type.String({ description: "Unsupported in v1 unless Nico bridge accepts it" })),
  max_turns: Type.Optional(Type.Number({ description: "Unsupported in v1 unless Nico bridge accepts it" })),
  run_in_background: Type.Optional(Type.Boolean({ description: "Run as Nico async subagent" })),
  resume: Type.Optional(Type.String({ description: "Unsupported in v1" })),
  isolated: Type.Optional(Type.Boolean({ description: "Unsupported in v1" })),
  inherit_context: Type.Optional(Type.Boolean({ description: "Use Nico fork context when true" })),
});

export type TaskInput = Static<typeof TaskSchema>;
```

- [ ] **Step 4: Create fake Pi API for tests**

Create `test/fakes.ts`:

```ts
import { EventEmitter } from "node:events";

export interface FakeToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (...args: any[]) => Promise<any> | any;
}

export interface FakeToolInfo {
  name: string;
  description: string;
  parameters?: unknown;
  sourceInfo?: unknown;
}

export class FakeEventBus {
  private readonly emitter = new EventEmitter();

  on(event: string, handler: (data: unknown) => void): () => void {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  emit(event: string, data: unknown): void {
    this.emitter.emit(event, data);
  }
}

export function createFakePi(options: { tools?: FakeToolInfo[] } = {}) {
  const handlers = new Map<string, Function[]>();
  const registeredTools = new Map<string, FakeToolDefinition>();
  const allTools = [...(options.tools ?? [])];
  const events = new FakeEventBus();

  const pi = {
    events,
    on(event: string, handler: Function) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool: FakeToolDefinition) {
      registeredTools.set(tool.name, tool);
      if (!allTools.some((t) => t.name === tool.name)) {
        allTools.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
      }
    },
    getAllTools() {
      return allTools;
    },
    getActiveTools() {
      return allTools.map((tool) => tool.name);
    },
    setActiveTools(_names: string[]) {},
    registerCommand(_name: string, _options: unknown) {},
  };

  return {
    pi: pi as any,
    events,
    registeredTools,
    async emit(event: string, payload: unknown, ctx: any) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload, ctx);
      }
    },
  };
}

export function createFakeCtx(cwd: string) {
  return {
    cwd,
    hasUI: false,
    ui: { notify() {} },
    sessionManager: { getBranch: () => [] },
    getSystemPrompt: () => "",
  } as any;
}
```

- [ ] **Step 5: Add package manifest test**

Create `test/package.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("package exposes a single Pi extension entry", () => {
  assert.deepEqual(pkg.pi.extensions, ["./src/index.ts"]);
});

test("package stays a thin adapter with only peer Pi runtime dependencies", () => {
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(pkg.peerDependencies.typebox, "*");
});
```

- [ ] **Step 6: Run tests to verify scaffold baseline**

Run:

```bash
npm install
npm run verify
```

Expected:

```text
npm run typecheck
npm test
# all tests pass
```

- [ ] **Step 7: Commit scaffold**

```bash
git add package.json tsconfig.json src/schemas.ts test/fakes.ts test/package.test.ts
git commit -m "chore: scaffold pi superpowers adapter"
```

---

### Task 2: Implement `TodoWrite`

**Files:**
- Create: `src/todos.ts`
- Create: `test/todos.test.ts`

- [ ] **Step 1: Write failing TodoWrite tests**

Create `test/todos.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePi } from "./fakes.ts";
import { formatTodos, registerTodoWriteTool, resetTodos } from "../src/todos.ts";

test("formatTodos reports empty state", () => {
  resetTodos();
  assert.equal(formatTodos(), "No todos. Use TodoWrite to create tasks.");
});

test("TodoWrite replaces todos and formats completion count", async () => {
  const { pi, registeredTools } = createFakePi();
  registerTodoWriteTool(pi);

  const tool = registeredTools.get("TodoWrite");
  assert.ok(tool);

  const result = await tool.execute("todo-1", {
    todos: [
      { id: "design", content: "Design adapter", status: "completed", priority: "high" },
      { id: "impl", content: "Implement adapter", status: "in_progress" },
      { id: "test", content: "Verify behavior", status: "pending", priority: "medium" },
    ],
  });

  const text = result.content[0].text;
  assert.match(text, /Todos \(1\/3 completed\):/);
  assert.match(text, /✅ \[HIGH\] Design adapter/);
  assert.match(text, /🔄 Implement adapter/);
  assert.match(text, /⭕ \[MEDIUM\] Verify behavior/);
  assert.deepEqual(result.details, { todoCount: 3, completedCount: 1 });
});

test("resetTodos clears session state", () => {
  resetTodos([{ id: "x", content: "x", status: "pending" }]);
  assert.match(formatTodos(), /Todos \(0\/1 completed\)/);
  resetTodos();
  assert.equal(formatTodos(), "No todos. Use TodoWrite to create tasks.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/todos.test.ts
```

Expected: FAIL because `src/todos.ts` does not exist.

- [ ] **Step 3: Implement TodoWrite tool**

Create `src/todos.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TodoWriteSchema, type TodoItem, type TodoStatus, type TodoWriteInput } from "./schemas.ts";

let todos: TodoItem[] = [];

function statusIcon(status: TodoStatus): string {
  if (status === "completed") return "✅";
  if (status === "in_progress") return "🔄";
  return "⭕";
}

function priorityLabel(priority: TodoItem["priority"]): string {
  return priority ? `[${priority.toUpperCase()}] ` : "";
}

export function resetTodos(next: TodoItem[] = []): void {
  todos = next.map((todo) => ({ ...todo }));
}

export function formatTodos(): string {
  if (todos.length === 0) return "No todos. Use TodoWrite to create tasks.";

  const completed = todos.filter((todo) => todo.status === "completed").length;
  const idWidth = todos.length >= 10 ? 2 : 1;
  const lines = todos.map((todo, index) => {
    const number = String(index + 1).padStart(idWidth);
    return `${number}. ${statusIcon(todo.status)} ${priorityLabel(todo.priority)}${todo.content}`;
  });

  return `Todos (${completed}/${todos.length} completed):\n${lines.join("\n")}`;
}

export function registerTodoWriteTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "TodoWrite",
    label: "TodoWrite",
    description: "Create, update, or replace the todo list for tracking task progress.",
    promptSnippet: "Track tasks with status (pending, in_progress, completed).",
    promptGuidelines: [
      "Use TodoWrite when starting a multi-step task to track progress.",
      "Update TodoWrite status as work progresses: pending, in_progress, completed.",
    ],
    parameters: TodoWriteSchema,
    async execute(_toolCallId, params: TodoWriteInput) {
      resetTodos(params.todos);
      const completedCount = todos.filter((todo) => todo.status === "completed").length;
      return {
        content: [{ type: "text" as const, text: formatTodos() }],
        details: { todoCount: todos.length, completedCount },
      };
    },
  });
}
```

- [ ] **Step 4: Run TodoWrite tests**

Run:

```bash
npm test -- test/todos.test.ts
```

Expected: PASS, all TodoWrite tests pass.

- [ ] **Step 5: Commit TodoWrite**

```bash
git add src/todos.ts test/todos.test.ts
git commit -m "feat: add superpowers TodoWrite tool"
```

---

### Task 3: Implement skill discovery and `Skill` tool

**Files:**
- Create: `src/skills.ts`
- Create: `test/skills.test.ts`

- [ ] **Step 1: Write failing skill tests**

Create `test/skills.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFakeCtx, createFakePi } from "./fakes.ts";
import {
  clearSkillCache,
  discoverSkills,
  findSkill,
  parseSkillFile,
  registerSkillTool,
  stripFrontmatter,
} from "../src/skills.ts";

async function makeSkill(root: string, name: string, body = "# Body\n\nUse this skill.") {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} desc\n---\n\n${body}`);
  return dir;
}

test("stripFrontmatter removes YAML frontmatter", () => {
  const content = "---\nname: x\ndescription: y\n---\n\n# Title\nBody";
  assert.equal(stripFrontmatter(content), "# Title\nBody");
});

test("parseSkillFile returns frontmatter name and body", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-parse-"));
  await makeSkill(root, "brainstorming", "# Brainstorming\ncontent");
  const parsed = await parseSkillFile(join(root, "brainstorming", "SKILL.md"));
  assert.equal(parsed.name, "brainstorming");
  assert.equal(parsed.description, "brainstorming desc");
  assert.equal(parsed.content, "# Brainstorming\ncontent");
});

test("discoverSkills finds directory skills from explicit roots", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "skill-discover-"));
  await makeSkill(root, "using-superpowers");
  const skills = await discoverSkills(process.cwd(), { extraRoots: [root] });
  assert.ok(skills.has("using-superpowers"));
  assert.equal(skills.get("using-superpowers")?.description, "using-superpowers desc");
});

test("findSkill returns undefined for missing skills", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "skill-missing-"));
  const skill = await findSkill("missing", process.cwd(), { extraRoots: [root] });
  assert.equal(skill, undefined);
});

test("Skill tool returns full stripped content", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "skill-tool-"));
  await makeSkill(root, "brainstorming", "# Brainstorming\nFull content");
  const { pi, registeredTools } = createFakePi();
  registerSkillTool(pi, { extraRoots: [root] });
  const tool = registeredTools.get("Skill");
  assert.ok(tool);

  const result = await tool.execute("skill-1", { skill: "brainstorming" }, undefined, undefined, createFakeCtx(process.cwd()));
  assert.match(result.content[0].text, /Loaded skill: brainstorming/);
  assert.match(result.content[0].text, /# Brainstorming\nFull content/);
  assert.equal(result.details.skillName, "brainstorming");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/skills.test.ts
```

Expected: FAIL because `src/skills.ts` does not exist.

- [ ] **Step 3: Implement skill discovery and Skill tool**

Create `src/skills.ts`:

```ts
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SkillSchema, type SkillInput } from "./schemas.ts";

export interface SkillMeta {
  name: string;
  description?: string;
  path: string;
  content?: string;
}

export interface SkillDiscoveryOptions {
  extraRoots?: string[];
}

const MAX_DISCOVERED_SKILLS = 500;

let skillCache: Map<string, SkillMeta> | null = null;

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  return { data, body: match[2]!.trim() };
}

export function stripFrontmatter(content: string): string {
  return parseFrontmatter(content).body;
}

export async function parseSkillFile(path: string): Promise<Required<SkillMeta>> {
  const raw = await readFile(path, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const fallbackName = basename(resolve(path, "..")).toLowerCase();
  return {
    name: data.name || fallbackName,
    description: data.description || "",
    path,
    content: body,
  };
}

async function collectSkillRoots(cwd: string, options: SkillDiscoveryOptions): Promise<string[]> {
  const roots = [
    join(homedir(), ".pi", "agent", "skills"),
    join(homedir(), ".agents", "skills"),
    join(cwd, ".pi", "skills"),
    join(cwd, ".agents", "skills"),
    ...(options.extraRoots ?? []),
  ];

  const gitPackagesDir = join(homedir(), ".pi", "agent", "git");
  await findSkillsDirs(gitPackagesDir, roots, 0);

  return Array.from(new Set(roots.map((root) => resolve(expandHome(root)))));
}

async function findSkillsDirs(base: string, results: string[], depth: number): Promise<void> {
  if (depth > 8 || !existsSync(base)) return;
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(base, entry.name);
    if (entry.name === "skills") {
      results.push(full);
      continue;
    }
    await findSkillsDirs(full, results, depth + 1);
  }
}

async function readRootSkills(root: string, skills: Map<string, SkillMeta>): Promise<void> {
  if (!existsSync(root)) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (skills.size >= MAX_DISCOVERED_SKILLS) return;
    if (!entry.isDirectory()) continue;
    const skillPath = join(root, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    try {
      const parsed = await parseSkillFile(skillPath);
      if (!skills.has(parsed.name)) {
        skills.set(parsed.name, { name: parsed.name, description: parsed.description, path: parsed.path });
      }
    } catch {
      continue;
    }
  }
}

export function clearSkillCache(): void {
  skillCache = null;
}

export async function discoverSkills(cwd: string, options: SkillDiscoveryOptions = {}): Promise<Map<string, SkillMeta>> {
  if (skillCache && !options.extraRoots?.length) return skillCache;

  const skills = new Map<string, SkillMeta>();
  for (const root of await collectSkillRoots(cwd, options)) {
    await readRootSkills(root, skills);
  }

  if (!options.extraRoots?.length) skillCache = skills;
  return skills;
}

export async function findSkill(name: string, cwd: string, options: SkillDiscoveryOptions = {}): Promise<SkillMeta | undefined> {
  const skills = await discoverSkills(cwd, options);
  return skills.get(name);
}

export async function loadSkill(name: string, cwd: string, options: SkillDiscoveryOptions = {}): Promise<Required<SkillMeta> | undefined> {
  const skill = await findSkill(name, cwd, options);
  if (!skill) return undefined;
  return parseSkillFile(skill.path);
}

export function registerSkillTool(pi: ExtensionAPI, options: SkillDiscoveryOptions = {}): void {
  pi.registerTool({
    name: "Skill",
    label: "Skill",
    description: "Load and invoke a skill by name. Use this tool instead of reading skill files directly.",
    promptSnippet: "Load specialized skill instructions for a matching workflow.",
    promptGuidelines: [
      "Use Skill before starting a task when a discovered skill applies.",
      "Use Skill instead of read for skill files.",
    ],
    parameters: SkillSchema,
    async execute(_toolCallId, params: SkillInput, _signal, _onUpdate, ctx: ExtensionContext) {
      const skill = await loadSkill(params.skill, ctx.cwd, options);
      if (!skill) {
        const available = Array.from((await discoverSkills(ctx.cwd, options)).keys()).sort();
        return {
          content: [{ type: "text" as const, text: `Skill "${params.skill}" not found.\n\nAvailable skills:\n${available.map((item) => `  - ${item}`).join("\n")}\n\nInstall Superpowers: pi install https://github.com/obra/superpowers` }],
          isError: true,
          details: { requestedSkill: params.skill, availableSkills: available },
        };
      }

      return {
        content: [{ type: "text" as const, text: `Loaded skill: ${skill.name}\n${skill.description ? `\nDescription: ${skill.description}\n` : ""}\n---\n\n${skill.content}` }],
        details: { skillName: skill.name, skillPath: skill.path, skillDescription: skill.description, totalLines: skill.content.split("\n").length },
      };
    },
  });
}
```

- [ ] **Step 4: Run skill tests**

Run:

```bash
npm test -- test/skills.test.ts
```

Expected: PASS, all skill tests pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run verify
```

Expected: PASS, typecheck and all tests pass.

- [ ] **Step 6: Commit skill tool**

```bash
git add src/skills.ts test/skills.test.ts
git commit -m "feat: add superpowers Skill tool"
```

---

### Task 4: Implement `using-superpowers` bootstrap injection

**Files:**
- Modify: `src/skills.ts`
- Create: `test/bootstrap.test.ts`

- [ ] **Step 1: Write failing bootstrap tests**

Create `test/bootstrap.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSuperpowersBootstrap, clearSkillCache } from "../src/skills.ts";

async function createUsingSuperpowers(root: string) {
  const dir = join(root, "using-superpowers");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: using-superpowers\ndescription: bootstrap\n---\n\n# Using Superpowers\n\nAlways invoke skills.`);
}

test("buildSuperpowersBootstrap injects skill body and Pi mapping", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "bootstrap-"));
  await createUsingSuperpowers(root);

  const result = await buildSuperpowersBootstrap(process.cwd(), { extraRoots: [root] });
  assert.equal(result.found, true);
  assert.match(result.prompt, /<superpowers-skills>/);
  assert.match(result.prompt, /# Using Superpowers/);
  assert.match(result.prompt, /Skill -> adapter Skill/);
  assert.match(result.prompt, /Task -> adapter Task backed by Nico pi-subagents/);
});

test("buildSuperpowersBootstrap returns warning when missing", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "bootstrap-missing-"));
  const result = await buildSuperpowersBootstrap(process.cwd(), { extraRoots: [root] });
  assert.equal(result.found, false);
  assert.match(result.prompt, /using-superpowers skill not found/);
  assert.match(result.prompt, /pi install https:\/\/github.com\/obra\/superpowers/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/bootstrap.test.ts
```

Expected: FAIL because `buildSuperpowersBootstrap` is not exported.

- [ ] **Step 3: Add bootstrap builder**

Append this code to `src/skills.ts`:

```ts
export interface BootstrapResult {
  found: boolean;
  prompt: string;
  skillPath?: string;
}

export async function buildSuperpowersBootstrap(cwd: string, options: SkillDiscoveryOptions = {}): Promise<BootstrapResult> {
  const skill = await loadSkill("using-superpowers", cwd, options);
  if (!skill) {
    return {
      found: false,
      prompt: `[pi-superpowers-adapter] using-superpowers skill not found. Install Superpowers with: pi install https://github.com/obra/superpowers`,
    };
  }

  const mapping = [
    "Pi tool mapping for Superpowers:",
    "- Skill -> adapter Skill",
    "- TodoWrite -> adapter TodoWrite",
    "- Task -> adapter Task backed by Nico pi-subagents",
    "- File and shell tools use Pi names: read, bash, edit, write",
  ].join("\n");

  return {
    found: true,
    skillPath: skill.path,
    prompt: `<superpowers-skills>\n${skill.content}\n\n${mapping}\n</superpowers-skills>`,
  };
}
```

- [ ] **Step 4: Run bootstrap tests**

Run:

```bash
npm test -- test/bootstrap.test.ts
```

Expected: PASS, bootstrap tests pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run verify
```

Expected: PASS, typecheck and all tests pass.

- [ ] **Step 6: Commit bootstrap builder**

```bash
git add src/skills.ts test/bootstrap.test.ts
git commit -m "feat: add superpowers bootstrap builder"
```

---

### Task 5: Implement `Task` bridge through Nico `pi-subagents` event bridge

**Files:**
- Create: `src/task-bridge.ts`
- Create: `test/task-bridge.test.ts`

- [ ] **Step 1: Write failing Task bridge tests**

Create `test/task-bridge.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createFakeCtx, createFakePi } from "./fakes.ts";
import {
  mapTaskToNicoParams,
  registerTaskTool,
  SLASH_SUBAGENT_CANCEL_EVENT,
  SLASH_SUBAGENT_REQUEST_EVENT,
  SLASH_SUBAGENT_RESPONSE_EVENT,
} from "../src/task-bridge.ts";

test("mapTaskToNicoParams maps Superpowers general-purpose to Nico worker", () => {
  const mapped = mapTaskToNicoParams({
    subagent_type: "general-purpose",
    description: "Implement task",
    prompt: "Do the work",
    model: "anthropic/claude-sonnet-4",
    run_in_background: true,
    inherit_context: true,
  });

  assert.deepEqual(mapped.params, {
    agent: "worker",
    task: "Do the work",
    model: "anthropic/claude-sonnet-4",
    async: true,
    context: "fork",
    clarify: false,
    agentScope: "both",
  });
  assert.deepEqual(mapped.warnings, []);
});

test("mapTaskToNicoParams fails unknown subagent type", () => {
  assert.throws(() => mapTaskToNicoParams({
    subagent_type: "Plan",
    description: "Plan",
    prompt: "Plan this",
  }), /Unsupported subagent_type/);
});

test("mapTaskToNicoParams warns on unsupported fields", () => {
  const mapped = mapTaskToNicoParams({
    subagent_type: "general-purpose",
    description: "Run",
    prompt: "Run",
    isolated: true,
    resume: "abc",
    thinking: "high",
    max_turns: 3,
  });
  assert.deepEqual(mapped.warnings, [
    "Task.isolated is not supported by pi-superpowers-adapter v1.",
    "Task.resume is not supported by pi-superpowers-adapter v1.",
    "Task.thinking is not forwarded by pi-superpowers-adapter v1.",
    "Task.max_turns is not forwarded by pi-superpowers-adapter v1.",
  ]);
});

test("Task returns install error when Nico subagent tool is unavailable", async () => {
  const { pi, registeredTools } = createFakePi();
  registerTaskTool(pi, { timeoutMs: 50 });
  const tool = registeredTools.get("Task");
  assert.ok(tool);

  const result = await tool.execute("task-1", {
    subagent_type: "general-purpose",
    description: "Run",
    prompt: "Run",
  }, new AbortController().signal, undefined, createFakeCtx(process.cwd()));

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /pi install npm:pi-subagents/);
});

test("Task emits Nico request and returns matching response", async () => {
  const { pi, events, registeredTools } = createFakePi({ tools: [{ name: "subagent", description: "Nico" }] });
  registerTaskTool(pi, { timeoutMs: 500 });
  const tool = registeredTools.get("Task");
  assert.ok(tool);

  events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data: any) => {
    assert.equal(data.params.agent, "worker");
    assert.equal(data.params.task, "Summarize README");
    events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
      requestId: data.requestId,
      isError: false,
      result: {
        content: [{ type: "text", text: "Worker result" }],
        details: { mode: "single", results: [] },
      },
    });
  });

  const result = await tool.execute("task-2", {
    subagent_type: "general-purpose",
    description: "Summarize",
    prompt: "Summarize README",
  }, new AbortController().signal, undefined, createFakeCtx(process.cwd()));

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Worker result/);
});

test("Task ignores mismatched response ids and resolves matching response", async () => {
  const { pi, events, registeredTools } = createFakePi({ tools: [{ name: "subagent", description: "Nico" }] });
  registerTaskTool(pi, { timeoutMs: 500 });
  const tool = registeredTools.get("Task");
  assert.ok(tool);

  events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data: any) => {
    events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
      requestId: "different-request",
      isError: false,
      result: { content: [{ type: "text", text: "Wrong result" }] },
    });
    events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
      requestId: data.requestId,
      isError: false,
      result: { content: [{ type: "text", text: "Right result" }] },
    });
  });

  const result = await tool.execute("task-3", {
    subagent_type: "general-purpose",
    description: "Match ids",
    prompt: "Match ids",
  }, new AbortController().signal, undefined, createFakeCtx(process.cwd()));

  assert.match(result.content[0].text, /Right result/);
  assert.doesNotMatch(result.content[0].text, /Wrong result/);
});

test("Task times out when Nico bridge does not respond", async () => {
  const { pi, registeredTools } = createFakePi({ tools: [{ name: "subagent", description: "Nico" }] });
  registerTaskTool(pi, { timeoutMs: 10 });
  const tool = registeredTools.get("Task");
  assert.ok(tool);

  const result = await tool.execute("task-4", {
    subagent_type: "general-purpose",
    description: "Timeout",
    prompt: "Timeout",
  }, new AbortController().signal, undefined, createFakeCtx(process.cwd()));

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Timed out waiting for Nico pi-subagents response/);
});

test("Task emits cancel when aborted", async () => {
  const { pi, events, registeredTools } = createFakePi({ tools: [{ name: "subagent", description: "Nico" }] });
  registerTaskTool(pi, { timeoutMs: 500 });
  const tool = registeredTools.get("Task");
  assert.ok(tool);

  const controller = new AbortController();
  let cancelled = false;

  events.on(SLASH_SUBAGENT_REQUEST_EVENT, () => controller.abort());
  events.on(SLASH_SUBAGENT_CANCEL_EVENT, () => {
    cancelled = true;
  });

  const result = await tool.execute("task-5", {
    subagent_type: "general-purpose",
    description: "Abort",
    prompt: "Abort",
  }, controller.signal, undefined, createFakeCtx(process.cwd()));

  assert.equal(cancelled, true);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /cancelled/i);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/task-bridge.test.ts
```

Expected: FAIL because `src/task-bridge.ts` does not exist.

- [ ] **Step 3: Implement Task bridge**

Create `src/task-bridge.ts`:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TaskSchema, type TaskInput } from "./schemas.ts";

// Verified against nicobailon/pi-subagents v0.24.2:
// src/shared/types.ts exports these constants and src/slash/slash-bridge.ts
// listens for request/cancel and emits response.
export const SLASH_SUBAGENT_REQUEST_EVENT = "subagent:slash:request";
export const SLASH_SUBAGENT_RESPONSE_EVENT = "subagent:slash:response";
export const SLASH_SUBAGENT_CANCEL_EVENT = "subagent:slash:cancel";

export interface NicoSubagentParams {
  agent: "worker";
  task: string;
  model?: string;
  async?: boolean;
  context: "fresh" | "fork";
  clarify: false;
  agentScope: "both";
}

export interface TaskMapping {
  params: NicoSubagentParams;
  warnings: string[];
}

export interface TaskBridgeOptions {
  timeoutMs?: number;
}

interface NicoResponse {
  requestId: string;
  result: ToolResult;
  isError: boolean;
  errorText?: string;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
  isError?: boolean;
}

function createRequestId(): string {
  return `superpowers-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function textResult(text: string, isError = false, details: Record<string, unknown> = {}): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text }], details };
  if (isError) result.isError = true;
  return result;
}

export function mapTaskToNicoParams(input: TaskInput): TaskMapping {
  if (input.subagent_type !== "general-purpose") {
    throw new Error(`Unsupported subagent_type "${input.subagent_type}". pi-superpowers-adapter v1 only supports Superpowers Task tool (general-purpose).`);
  }

  const warnings: string[] = [];
  if (input.isolated) warnings.push("Task.isolated is not supported by pi-superpowers-adapter v1.");
  if (input.resume) warnings.push("Task.resume is not supported by pi-superpowers-adapter v1.");
  if (input.thinking) warnings.push("Task.thinking is not forwarded by pi-superpowers-adapter v1.");
  if (input.max_turns !== undefined) warnings.push("Task.max_turns is not forwarded by pi-superpowers-adapter v1.");

  const params: NicoSubagentParams = {
    agent: "worker",
    task: input.prompt,
    context: input.inherit_context ? "fork" : "fresh",
    clarify: false,
    agentScope: "both",
  };

  if (input.model) params.model = input.model;
  if (input.run_in_background !== undefined) params.async = input.run_in_background;

  return { params, warnings };
}

function hasNicoSubagentTool(pi: ExtensionAPI): boolean {
  return pi.getAllTools().some((tool) => tool.name === "subagent") || pi.getActiveTools().includes("subagent");
}

async function requestNicoSubagent(pi: ExtensionAPI, params: NicoSubagentParams, signal: AbortSignal | undefined, timeoutMs: number): Promise<ToolResult> {
  const requestId = createRequestId();

  return new Promise<ToolResult>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let removeAbortListener: (() => void) | undefined;

    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      if (unsubscribe) unsubscribe();
      if (removeAbortListener) removeAbortListener();
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(textResult("Timed out waiting for Nico pi-subagents response on subagent:slash:response. Confirm pi-subagents is installed, active, and compatible.", true, { requestId }));
    }, timeoutMs);

    unsubscribe = pi.events.on(SLASH_SUBAGENT_RESPONSE_EVENT, (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const response = data as Partial<NicoResponse>;
      if (response.requestId !== requestId) return;
      if (!response.result) {
        finish(textResult(response.errorText || "Nico pi-subagents returned no result.", true, { requestId }));
        return;
      }
      if (response.isError) {
        finish({ ...response.result, isError: true });
        return;
      }
      finish(response.result);
    }) as (() => void) | undefined;

    const cancel = () => {
      pi.events.emit(SLASH_SUBAGENT_CANCEL_EVENT, { requestId });
      finish(textResult("Task cancelled before Nico pi-subagents completed.", true, { requestId }));
    };

    if (signal?.aborted) {
      cancel();
      return;
    }

    if (signal) {
      signal.addEventListener("abort", cancel, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", cancel);
    }
    pi.events.emit(SLASH_SUBAGENT_REQUEST_EVENT, { requestId, params });
  });
}

export function registerTaskTool(pi: ExtensionAPI, options: TaskBridgeOptions = {}): void {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  pi.registerTool({
    name: "Task",
    label: "Task",
    description: "Dispatch a Superpowers-compatible subagent task. v1 supports Task tool (general-purpose) backed by Nico pi-subagents worker.",
    promptSnippet: "Dispatch Superpowers general-purpose subagent tasks through Nico pi-subagents.",
    promptGuidelines: [
      "Use Task only for Superpowers subagent workflows that call Task tool (general-purpose).",
      "Task requires Nico pi-subagents to be installed and active.",
    ],
    parameters: TaskSchema,
    async execute(_toolCallId, params: TaskInput, signal: AbortSignal | undefined, _onUpdate, _ctx: ExtensionContext) {
      if (!hasNicoSubagentTool(pi)) {
        return textResult("Error: Task requires Nico pi-subagents. Install it with: pi install npm:pi-subagents", true, { missingTool: "subagent" });
      }

      let mapping: TaskMapping;
      try {
        mapping = mapTaskToNicoParams(params);
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true, { subagentType: params.subagent_type });
      }

      const result = await requestNicoSubagent(pi, mapping.params, signal, timeoutMs);
      if (mapping.warnings.length === 0) return result;

      const warningText = `\n\nWarnings:\n${mapping.warnings.map((warning) => `- ${warning}`).join("\n")}`;
      return {
        ...result,
        content: result.content.map((item, index) => index === 0 && item.type === "text" ? { ...item, text: `${item.text}${warningText}` } : item),
        details: { taskWarnings: mapping.warnings, nicoDetails: result.details },
      };
    },
  });
}
```

- [ ] **Step 4: Run Task bridge tests**

Run:

```bash
npm test -- test/task-bridge.test.ts
```

Expected: PASS, Task bridge tests pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run verify
```

Expected: PASS, typecheck and all tests pass.

- [ ] **Step 6: Commit Task bridge**

```bash
git add src/task-bridge.ts test/task-bridge.test.ts
git commit -m "feat: bridge superpowers Task to nico subagents"
```

---

### Task 6: Wire extension entrypoint and lifecycle hooks

**Files:**
- Create: `src/index.ts`
- Modify: `test/bootstrap.test.ts`

- [ ] **Step 1: Write failing entrypoint lifecycle test**

Append this test to `test/bootstrap.test.ts`:

```ts
import registerExtension from "../src/index.ts";
import { createFakePi } from "./fakes.ts";

test("extension registers tools and injects bootstrap on before_agent_start", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "entrypoint-"));
  await createUsingSuperpowers(root);
  process.env.PI_SUPERPOWERS_ADAPTER_EXTRA_SKILL_ROOTS = root;

  const { pi, registeredTools, emit } = createFakePi({ tools: [{ name: "subagent", description: "Nico" }] });
  registerExtension(pi);

  assert.ok(registeredTools.has("Skill"));
  assert.ok(registeredTools.has("TodoWrite"));
  assert.ok(registeredTools.has("Task"));

  const result = await emit("before_agent_start", { systemPrompt: "base" }, { cwd: process.cwd(), hasUI: false, ui: { notify() {} } });
  assert.equal(result, undefined);

  delete process.env.PI_SUPERPOWERS_ADAPTER_EXTRA_SKILL_ROOTS;
});
```

Replace `test/fakes.ts` `emit` helper with result capture:

```ts
async emit(event: string, payload: unknown, ctx: any) {
  let last;
  for (const handler of handlers.get(event) ?? []) {
    const result = await handler(payload, ctx);
    if (result !== undefined) last = result;
  }
  return last;
},
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/bootstrap.test.ts
```

Expected: FAIL because `src/index.ts` does not exist or bootstrap hook does not return system prompt.

- [ ] **Step 3: Implement extension entrypoint**

Create `src/index.ts`:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSuperpowersBootstrap, clearSkillCache, registerSkillTool, type SkillDiscoveryOptions } from "./skills.ts";
import { registerTaskTool } from "./task-bridge.ts";
import { registerTodoWriteTool, resetTodos } from "./todos.ts";

function extraRootsFromEnv(): string[] {
  const raw = process.env.PI_SUPERPOWERS_ADAPTER_EXTRA_SKILL_ROOTS;
  if (!raw) return [];
  return raw.split(":").map((item) => item.trim()).filter(Boolean);
}

function discoveryOptions(): SkillDiscoveryOptions {
  return { extraRoots: extraRootsFromEnv() };
}

export default function registerPiSuperpowersAdapter(pi: ExtensionAPI): void {
  registerTodoWriteTool(pi);
  registerSkillTool(pi, discoveryOptions());
  registerTaskTool(pi);

  pi.on("session_start", () => {
    resetTodos();
    clearSkillCache();
  });

  pi.on("resources_discover", () => {
    clearSkillCache();
  });

  pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
    const bootstrap = await buildSuperpowersBootstrap(ctx.cwd, discoveryOptions());
    if (!bootstrap.found && ctx.hasUI) ctx.ui.notify(bootstrap.prompt, "warning");
    return { systemPrompt: `${event.systemPrompt}\n\n${bootstrap.prompt}` };
  });
}
```

- [ ] **Step 4: Fix entrypoint test assertion**

Update the appended entrypoint test in `test/bootstrap.test.ts` so it asserts returned system prompt:

```ts
  const result = await emit("before_agent_start", { systemPrompt: "base" }, { cwd: process.cwd(), hasUI: false, ui: { notify() {} } });
  assert.match(result.systemPrompt, /base/);
  assert.match(result.systemPrompt, /<superpowers-skills>/);
  assert.match(result.systemPrompt, /Always invoke skills/);
```

- [ ] **Step 5: Run bootstrap tests**

Run:

```bash
npm test -- test/bootstrap.test.ts
```

Expected: PASS, bootstrap and entrypoint tests pass.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run verify
```

Expected: PASS, typecheck and all tests pass.

- [ ] **Step 7: Commit entrypoint**

```bash
git add src/index.ts test/bootstrap.test.ts test/fakes.ts
git commit -m "feat: wire superpowers adapter extension"
```

---

### Task 7: Add README and manual acceptance procedure

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md`:

````md
# pi-superpowers-adapter

Thin Pi adapter for upstream [obra/superpowers](https://github.com/obra/superpowers).

This package only makes Superpowers work in Pi as close as possible to the upstream author's intended behavior. It does not install, fork, vendor, or modify Superpowers. It does not install, fork, vendor, or modify Nico Bailon's `pi-subagents`.

## Install

Install the upstream packages explicitly:

```bash
pi install https://github.com/obra/superpowers
pi install npm:pi-subagents
pi install https://github.com/imrellx/pi-superpowers-adapter
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
````

- [ ] **Step 2: Run markdown sanity check**

Run:

```bash
rg -n "tintinweb-style `Agent`|general-purpose|pi install npm:pi-subagents" README.md
```

Expected: output includes the non-goal statement, mapping statement, and install command.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run verify
```

Expected: PASS, typecheck and all tests pass.

- [ ] **Step 4: Commit README**

```bash
git add README.md
git commit -m "docs: document superpowers adapter usage"
```

---

### Task 8: Final verification and cleanup

**Files:**
- Verify only; no expected source changes.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run verify
```

Expected:

```text
npm run typecheck
npm test
# all tests pass
```

- [ ] **Step 2: Check for placeholder text and debug artifacts**

Run:

```bash
rg -n "TB[D]|TO[D]O|PLACEHOLDE[R]|console\.log|debugger|\.only\(" . --glob '!node_modules/**' || true
```

Expected: no output.

- [ ] **Step 3: Check git status**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 4: Manual local package load smoke test**

Run from this repository:

```bash
pi -e . -p "Use Skill to load brainstorming, then stop after confirming it loaded." --no-session
```

Expected: output shows the `Skill` tool is available and loads `brainstorming` when Superpowers is installed. If Superpowers is not installed in the developer environment, expected output is the explicit install warning from the adapter.

- [ ] **Step 5: Manual Task bridge smoke test**

Run with Nico `pi-subagents` installed:

```bash
pi -e . -p "Use Task with subagent_type general-purpose to ask a worker to read README.md and summarize it in one sentence." --no-session
```

Expected: the adapter `Task` tool emits a Nico subagent request and returns the worker result. If Nico `pi-subagents` is not installed, expected output is the explicit `pi install npm:pi-subagents` error.

- [ ] **Step 6: Commit final cleanup only if files changed**

If Step 2 through Step 5 required documentation or test fixes, commit them:

```bash
git add README.md src test package.json tsconfig.json
git commit -m "chore: finalize adapter verification"
```

Expected: either a cleanup commit is created for real fixes, or no commit is created because the working tree is clean.

---

## Self-Review Checklist

Spec coverage:

- Bootstrap `using-superpowers` automatically: Task 4 and Task 6.
- Register `Skill`: Task 3 and Task 6.
- Register `TodoWrite`: Task 2 and Task 6.
- Register `Task` backed by Nico `pi-subagents`: Task 5 and Task 6.
- Keep scope thin with manual installs: Task 1 package manifest and Task 7 README.
- Exclude tintinweb API emulation: Task 7 README and Task 5 schema surface.
- Fail loudly when upstream pieces are missing: Task 3 missing Skill test and Task 5 missing Nico test.
- Prove behavior: Task 8 verification.

Implementation evidence recorded:

- Pi package docs say Pi-bundled core packages, including `@earendil-works/pi-coding-agent` and `typebox`, should be listed in `peerDependencies` with `"*"`; this plan follows that convention.
- npm metadata was checked for dev dependency versions: `typescript@6.0.3`, `@types/node@25.7.0`, `typebox@1.1.38`, and `@earendil-works/pi-coding-agent@0.74.0` exist.
- Nico event constants were checked in `nicobailon/pi-subagents` v0.24.2 source: `src/shared/types.ts` exports `subagent:slash:request`, `subagent:slash:response`, and `subagent:slash:cancel`; `src/slash/slash-bridge.ts` listens for request/cancel and emits response.
- Pi extension docs show `before_agent_start` handlers can return `{ systemPrompt }` and `resources_discover` exists for resource reload behavior.

Implementation risk recorded:

- The Task bridge uses Nico's `subagent:slash:*` event bridge because Pi ExtensionAPI does not expose a public method for invoking another extension's registered tool by name.
- This event bridge is source-observed in Nico `pi-subagents` and should be covered by Task bridge tests plus manual smoke tests.
- If Nico changes these event names or payloads, `Task` fails by timeout with a clear compatibility error instead of silently degrading.
