import { Type } from "@sinclair/typebox";
import { PlannerSystem } from "../execution-planner.js";
import { reasoningTraces } from "../reasoning-trace.js";
import { taskTracker } from "../task-tracker.js";

const planner = new PlannerSystem();

/**
 * TypeBox Schema definitions for swarm orchestration, introspection, and task planning.
 * Matches the existing -def.ts pattern (TypeBox schema + executor).
 */
export function createSwarmTools(userId: string) {
  return [
    {
      name: "introspect",
      label: "Introspect",
      description:
        "Review your own past reasoning traces (thought process) for a given context to maintain consistency and learn from past decisions.",
      parameters: Type.Object({
        contextId: Type.String({
          description: "The context or conversation ID to review reasoning for",
        }),
      }),
      execute: async (args: any) => {
        const trace = await reasoningTraces.reviewMyReasoning(userId, args.contextId);
        return trace;
      },
    },
    {
      name: "plan_task",
      label: "Plan Task",
      description:
        "Create a step-by-step execution plan for a complex multi-step objective. Returns a structured plan with ordered steps.",
      parameters: Type.Object({
        objective: Type.String({ description: "The complex objective to plan for" }),
        steps: Type.Array(Type.String(), { 
          description: "Ordered list of step descriptions",
          default: []
        }),
      }),
      execute: async (args: any) => {
        const plan = taskTracker.planTask(args.objective, args.steps);
        return JSON.stringify(plan, null, 2);
      },
    },
    {
      name: "advance_task",
      label: "Advance Task",
      description:
        "Mark the current active step of a task plan as completed and advance to the next step.",
      parameters: Type.Object({
        taskId: Type.String({ description: "The task plan ID to advance" }),
      }),
      execute: async (args: any) => {
        const updated = taskTracker.completeActiveStep(args.taskId);
        if (!updated) {return "Task not found.";}
        return JSON.stringify(updated, null, 2);
      },
    },
    {
      name: "task_status",
      label: "Task Status",
      description: "Get the current status and progress of a task plan.",
      parameters: Type.Object({
        taskId: Type.String({ description: "The task plan ID to check" }),
      }),
      execute: async (args: any) => {
        const status = taskTracker.getTaskStatus(args.taskId);
        if (!status) {return "Task not found.";}
        return JSON.stringify(status, null, 2);
      },
    },
    {
      name: "generate_execution_plan",
      label: "Generate Execution Plan",
      description:
        "Generate a DAG (directed acyclic graph) execution plan for a complex objective, breaking it into parallel and sequential stages.",
      parameters: Type.Object({
        objective: Type.String({ description: "The complex objective to generate a DAG plan for" }),
      }),
      execute: async (args: any) => {
        const plan = await planner.generatePlan(args.objective);
        return JSON.stringify(plan, null, 2);
      },
    },
  ];
}
