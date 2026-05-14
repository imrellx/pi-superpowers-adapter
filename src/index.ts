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
