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
