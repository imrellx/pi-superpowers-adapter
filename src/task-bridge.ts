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
  result?: ToolResult;
  isError?: boolean;
  errorText?: string;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
}

function createRequestId(): string {
  return `superpowers-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function textFromResult(result: ToolResult | undefined): string | undefined {
  return result?.content.find((item) => item.type === "text")?.text;
}

function normalizeToolResult(result: ToolResult): ToolResult {
  return {
    content: result.content,
    details: result.details ?? {},
  };
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

  return new Promise<ToolResult>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let removeAbortListener: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (unsubscribe) unsubscribe();
      if (removeAbortListener) removeAbortListener();
      if (timer) clearTimeout(timer);
    };

    const resolveOnce = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(normalizeToolResult(result));
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    timer = setTimeout(() => {
      rejectOnce(new Error("Timed out waiting for Nico pi-subagents response on subagent:slash:response. Confirm pi-subagents is installed, active, and compatible."));
    }, timeoutMs);

    unsubscribe = pi.events.on(SLASH_SUBAGENT_RESPONSE_EVENT, (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const response = data as Partial<NicoResponse>;
      if (response.requestId !== requestId) return;
      if (!response.result) {
        rejectOnce(new Error(response.errorText || "Nico pi-subagents returned no result."));
        return;
      }
      if (response.isError) {
        rejectOnce(new Error(response.errorText || textFromResult(response.result) || "Nico pi-subagents returned an error."));
        return;
      }
      resolveOnce(response.result);
    }) as (() => void) | undefined;

    const cancel = () => {
      pi.events.emit(SLASH_SUBAGENT_CANCEL_EVENT, { requestId });
      rejectOnce(new Error("Task cancelled before Nico pi-subagents completed."));
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
        throw new Error("Task requires Nico pi-subagents. Install it with: pi install npm:pi-subagents");
      }

      const mapping = mapTaskToNicoParams(params);
      const result = await requestNicoSubagent(pi, mapping.params, signal, timeoutMs);
      if (mapping.warnings.length === 0) return result;

      const warningText = `\n\nWarnings:\n${mapping.warnings.map((warning) => `- ${warning}`).join("\n")}`;
      return {
        content: result.content.map((item, index) => index === 0 && item.type === "text" ? { ...item, text: `${item.text}${warningText}` } : item),
        details: { taskWarnings: mapping.warnings, nicoDetails: result.details },
      };
    },
  });
}
