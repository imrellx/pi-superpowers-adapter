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

test("Task throws install error when Nico subagent tool is unavailable", async () => {
  const { pi, registeredTools } = createFakePi();
  registerTaskTool(pi, { timeoutMs: 50 });
  const tool = registeredTools.get("Task");
  assert.ok(tool);

  await assert.rejects(() => tool.execute("task-1", {
    subagent_type: "general-purpose",
    description: "Run",
    prompt: "Run",
  }, new AbortController().signal, undefined, createFakeCtx(process.cwd())), /pi install npm:pi-subagents/);
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
      result: { content: [{ type: "text", text: "Wrong result" }], details: {} },
    });
    events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
      requestId: data.requestId,
      isError: false,
      result: { content: [{ type: "text", text: "Right result" }], details: {} },
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

  await assert.rejects(() => tool.execute("task-4", {
    subagent_type: "general-purpose",
    description: "Timeout",
    prompt: "Timeout",
  }, new AbortController().signal, undefined, createFakeCtx(process.cwd())), /Timed out waiting for Nico pi-subagents response/);
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

  await assert.rejects(() => tool.execute("task-5", {
    subagent_type: "general-purpose",
    description: "Abort",
    prompt: "Abort",
  }, controller.signal, undefined, createFakeCtx(process.cwd())), /cancelled/i);

  assert.equal(cancelled, true);
});
