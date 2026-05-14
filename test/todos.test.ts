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
