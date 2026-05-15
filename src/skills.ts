import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, Skill as PiSkill } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SkillSchema, type SkillInput } from "./schemas.ts";

export interface SkillMeta {
  name: string;
  description?: string;
  path: string;
  content?: string;
}

export interface SkillDiscoveryOptions {
  extraRoots?: string[];
  includeDefaultRoots?: boolean;
}

const MAX_DISCOVERED_SKILLS = 500;

let skillCache: Map<string, SkillMeta> | null = null;
let canonicalSkillCache: Map<string, SkillMeta> | null = null;

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
  const roots = options.includeDefaultRoots === false ? [] : [
    join(homedir(), ".pi", "agent", "skills"),
    join(homedir(), ".agents", "skills"),
    join(cwd, ".pi", "skills"),
    join(cwd, ".agents", "skills"),
  ];

  roots.push(...(options.extraRoots ?? []));

  if (options.includeDefaultRoots !== false) {
    const gitPackagesDir = join(homedir(), ".pi", "agent", "git");
    await findSkillsDirs(gitPackagesDir, roots, 0);
  }

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

export function setCanonicalSkills(skills: PiSkill[] | undefined): void {
  canonicalSkillCache = skills
    ? new Map(skills.map((skill) => [skill.name, { name: skill.name, description: skill.description, path: skill.filePath }]))
    : null;
}

export function clearSkillCache(): void {
  skillCache = null;
  canonicalSkillCache = null;
}

export async function discoverSkills(cwd: string, options: SkillDiscoveryOptions = {}): Promise<Map<string, SkillMeta>> {
  if (canonicalSkillCache) return canonicalSkillCache;
  if (skillCache && !options.extraRoots?.length && options.includeDefaultRoots !== false) return skillCache;

  const skills = new Map<string, SkillMeta>();
  for (const root of await collectSkillRoots(cwd, options)) {
    await readRootSkills(root, skills);
  }

  if (!options.extraRoots?.length && options.includeDefaultRoots !== false) skillCache = skills;
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
        throw new Error(`Skill "${params.skill}" not found.\n\nAvailable skills:\n${available.map((item) => `  - ${item}`).join("\n")}\n\nInstall Superpowers: pi install https://github.com/obra/superpowers`);
      }

      return {
        content: [{ type: "text" as const, text: `Loaded skill: ${skill.name}\n${skill.description ? `\nDescription: ${skill.description}\n` : ""}\n---\n\n${skill.content}` }],
        details: { skillName: skill.name, skillPath: skill.path, skillDescription: skill.description, totalLines: skill.content.split("\n").length },
      };
    },
    renderResult(result, _options, _theme, context) {
      const text = result.content.find((item) => item.type === "text")?.text ?? "";
      if (context.isError) return new Text(text || "Skill failed.", 0, 0);

      const details = result.details as { skillName?: string } | undefined;
      return new Text(`Loaded skill: ${details?.skillName ?? "unknown"}`, 0, 0);
    },
  });
}

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
      prompt: "[pi-superpowers-adapter] using-superpowers skill not found. Install Superpowers with: pi install https://github.com/obra/superpowers",
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
