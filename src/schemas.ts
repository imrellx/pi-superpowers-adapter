import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const TodoStatusSchema = StringEnum(["pending", "in_progress", "completed"] as const);

export const TodoPrioritySchema = StringEnum(["high", "medium", "low"] as const);

export const TodoWriteSchema = Type.Object({
  todos: Type.Array(Type.Object({
    id: Type.String({ description: "Unique identifier for the todo item" }),
    content: Type.String({ description: "The content/description of the todo item" }),
    status: TodoStatusSchema,
    priority: Type.Optional(TodoPrioritySchema),
  })),
});

export type TodoWriteInput = Static<typeof TodoWriteSchema>;
export type TodoStatus = Static<typeof TodoStatusSchema>;
export type TodoPriority = Static<typeof TodoPrioritySchema>;
export type TodoItem = TodoWriteInput["todos"][number];

export const SkillSchema = Type.Object({
  skill: Type.String({ description: "Name of the skill to load, for example brainstorming" }),
});

export type SkillInput = Static<typeof SkillSchema>;

export const TaskSchema = Type.Object({
  subagent_type: Type.String({ description: "Superpowers subagent type. v1 supports general-purpose." }),
  prompt: Type.String({ description: "Task prompt for the subagent" }),
  description: Type.String({ description: "Short task description" }),
  model: Type.Optional(Type.String({ description: "Optional model override forwarded to Nico pi-subagents" })),
  thinking: Type.Optional(Type.String({ description: "Unsupported in v1 unless Nico bridge accepts it" })),
  max_turns: Type.Optional(Type.Number({ description: "Unsupported in v1 unless Nico bridge accepts it" })),
  run_in_background: Type.Optional(Type.Boolean({ description: "Run as Nico async subagent" })),
  resume: Type.Optional(Type.String({ description: "Unsupported in v1" })),
  isolated: Type.Optional(Type.Boolean({ description: "Unsupported in v1" })),
  inherit_context: Type.Optional(Type.Boolean({ description: "Use Nico fork context when true" })),
});

export type TaskInput = Static<typeof TaskSchema>;
