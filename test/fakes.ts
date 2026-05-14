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
