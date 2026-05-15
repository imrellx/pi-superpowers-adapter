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
  setCanonicalSkills,
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

test("Skill tool resolves canonical Pi skills before filesystem discovery", async () => {
  clearSkillCache();
  const canonicalRoot = await mkdtemp(join(tmpdir(), "canonical-skill-"));
  await makeSkill(canonicalRoot, "librarian", "# Librarian\nCanonical content");
  const fallbackRoot = await mkdtemp(join(tmpdir(), "fallback-skill-"));
  await makeSkill(fallbackRoot, "librarian", "# Librarian\nFallback content");
  setCanonicalSkills([
    {
      name: "librarian",
      description: "canonical desc",
      filePath: join(canonicalRoot, "librarian", "SKILL.md"),
      baseDir: join(canonicalRoot, "librarian"),
      sourceInfo: { source: "npm:pi-web-access" },
      disableModelInvocation: false,
    } as any,
  ]);

  const { pi, registeredTools } = createFakePi();
  registerSkillTool(pi, { extraRoots: [fallbackRoot] });
  const tool = registeredTools.get("Skill");
  assert.ok(tool);

  const result = await tool.execute("skill-1", { skill: "librarian" }, undefined, undefined, createFakeCtx(process.cwd()));
  assert.match(result.content[0].text, /Canonical content/);
  assert.doesNotMatch(result.content[0].text, /Fallback content/);
  assert.equal(result.details.skillPath, join(canonicalRoot, "librarian", "SKILL.md"));
});

test("Skill tool missing error lists canonical skills when canonical cache is populated", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "canonical-missing-"));
  await makeSkill(root, "librarian");
  setCanonicalSkills([
    {
      name: "librarian",
      description: "canonical desc",
      filePath: join(root, "librarian", "SKILL.md"),
      baseDir: join(root, "librarian"),
      sourceInfo: { source: "npm:pi-web-access" },
      disableModelInvocation: false,
    } as any,
  ]);

  const { pi, registeredTools } = createFakePi();
  registerSkillTool(pi);
  const tool = registeredTools.get("Skill");
  assert.ok(tool);

  await assert.rejects(
    () => tool.execute("skill-1", { skill: "missing" }, undefined, undefined, createFakeCtx(process.cwd())),
    (error: any) => {
      assert.match(error.message, /Skill "missing" not found/);
      assert.match(error.message, /  - librarian/);
      assert.doesNotMatch(error.message, /brainstorming/);
      return true;
    },
  );
});

test("Skill renderer hides skill body in collapsed and expanded views", async () => {
  clearSkillCache();
  const root = await mkdtemp(join(tmpdir(), "skill-render-"));
  await makeSkill(root, "using-superpowers", "# Using Superpowers\nSecret instructions");
  const { pi, registeredTools } = createFakePi();
  registerSkillTool(pi, { extraRoots: [root] });
  const tool = registeredTools.get("Skill") as any;
  assert.ok(tool);

  const result = await tool.execute("skill-1", { skill: "using-superpowers" }, undefined, undefined, createFakeCtx(process.cwd()));
  for (const expanded of [false, true]) {
    const component = tool.renderResult(result, { expanded, isPartial: false }, undefined, { isError: false });
    const rendered = component.render(120).join("\n");
    assert.match(rendered, /Loaded skill: using-superpowers/);
    assert.doesNotMatch(rendered, /Secret instructions/);
    assert.doesNotMatch(rendered, /# Using Superpowers/);
    assert.doesNotMatch(rendered, /Description:/);
  }
});
