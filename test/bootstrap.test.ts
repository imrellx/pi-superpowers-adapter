import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import registerExtension from "../src/index.ts";
import { buildSuperpowersBootstrap, clearSkillCache } from "../src/skills.ts";
import { createFakePi } from "./fakes.ts";

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
  const result = await buildSuperpowersBootstrap(process.cwd(), { extraRoots: [root], includeDefaultRoots: false });
  assert.equal(result.found, false);
  assert.match(result.prompt, /using-superpowers skill not found/);
  assert.match(result.prompt, /pi install https:\/\/github.com\/obra\/superpowers/);
});

test("extension registers tools and injects bootstrap on before_agent_start", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "entrypoint-"));
  await createUsingSuperpowers(root);
  process.env.PI_SUPERPOWERS_ADAPTER_EXTRA_SKILL_ROOTS = root;

  try {
    const { pi, registeredTools, emit } = createFakePi({ tools: [{ name: "subagent", description: "Nico" }] });
    registerExtension(pi);

    assert.ok(registeredTools.has("Skill"));
    assert.ok(registeredTools.has("TodoWrite"));
    assert.ok(registeredTools.has("Task"));

    const result = await emit("before_agent_start", { systemPrompt: "base" }, { cwd: process.cwd(), hasUI: false, ui: { notify() {} } });
    assert.match(result.systemPrompt, /base/);
    assert.match(result.systemPrompt, /<superpowers-skills>/);
    assert.match(result.systemPrompt, /Always invoke skills/);
  } finally {
    delete process.env.PI_SUPERPOWERS_ADAPTER_EXTRA_SKILL_ROOTS;
  }
});
