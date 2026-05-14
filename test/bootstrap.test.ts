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
  const result = await buildSuperpowersBootstrap(process.cwd(), { extraRoots: [root], includeDefaultRoots: false });
  assert.equal(result.found, false);
  assert.match(result.prompt, /using-superpowers skill not found/);
  assert.match(result.prompt, /pi install https:\/\/github.com\/obra\/superpowers/);
});
