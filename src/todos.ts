import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TodoWriteSchema, type TodoItem, type TodoStatus, type TodoWriteInput } from "./schemas.ts";

let todos: TodoItem[] = [];

function statusIcon(status: TodoStatus): string {
  if (status === "completed") return "✅";
  if (status === "in_progress") return "🔄";
  return "⭕";
}

function priorityLabel(priority: TodoItem["priority"]): string {
  return priority ? `[${priority.toUpperCase()}] ` : "";
}

export function resetTodos(next: TodoItem[] = []): void {
  todos = next.map((todo) => ({ ...todo }));
}

export function formatTodos(): string {
  if (todos.length === 0) return "No todos. Use TodoWrite to create tasks.";

  const completed = todos.filter((todo) => todo.status === "completed").length;
  const idWidth = todos.length >= 10 ? 2 : 1;
  const lines = todos.map((todo, index) => {
    const number = String(index + 1).padStart(idWidth);
    return `${number}. ${statusIcon(todo.status)} ${priorityLabel(todo.priority)}${todo.content}`;
  });

  return `Todos (${completed}/${todos.length} completed):\n${lines.join("\n")}`;
}

export function registerTodoWriteTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "TodoWrite",
    label: "TodoWrite",
    description: "Create, update, or replace the todo list for tracking task progress.",
    promptSnippet: "Track tasks with status (pending, in_progress, completed).",
    promptGuidelines: [
      "Use TodoWrite when starting a multi-step task to track progress.",
      "Update TodoWrite status as work progresses: pending, in_progress, completed.",
    ],
    parameters: TodoWriteSchema,
    async execute(_toolCallId, params: TodoWriteInput) {
      resetTodos(params.todos);
      const completedCount = todos.filter((todo) => todo.status === "completed").length;
      return {
        content: [{ type: "text" as const, text: formatTodos() }],
        details: { todoCount: todos.length, completedCount },
      };
    },
  });
}
