import { describe, expect, it, vi } from "vitest";

// Mock heavy dependencies
vi.mock("../execution-planner.js", () => {
  class MockPlanner {
    async generatePlan(objective: string) {
      return {
        objective,
        stages: [{ name: "stage1", steps: ["step1"] }],
      };
    }
  }
  return { PlannerSystem: MockPlanner };
});

vi.mock("../reasoning-trace.js", () => ({
  reasoningTraces: {
    reviewMyReasoning: vi.fn(async (_userId: string, contextId: string) =>
      `Reasoning trace for context: ${contextId}`),
  },
}));

vi.mock("../task-tracker.js", () => ({
  taskTracker: {
    planTask: vi.fn((objective: string, steps: string[]) => ({
      id: "task_123",
      objective,
      steps: steps.map((s, i) => ({ step: i, description: s, status: "pending" })),
    })),
    completeActiveStep: vi.fn((taskId: string) => {
      if (taskId === "nonexistent") {return null;}
      return { id: taskId, activeStep: 1 };
    }),
    getTaskStatus: vi.fn((taskId: string) => {
      if (taskId === "nonexistent") {return null;}
      return { id: taskId, status: "in_progress", completedSteps: 1 };
    }),
  },
}));

const { createSwarmTools } = await import("./swarm-tools-def.js");

describe("Swarm Tools", () => {
  const tools = createSwarmTools("test-user");

  it("returns 5 swarm tool definitions", () => {
    expect(tools).toHaveLength(5);
  });

  it("all tools have name, description, and parameters", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });

  it("introspect returns reasoning trace", async () => {
    const tool = tools.find((t) => t.name === "introspect")!;
    const result = await tool.execute({ contextId: "ctx-1" });
    expect(result).toContain("ctx-1");
  });

  it("plan_task creates a structured plan", async () => {
    const tool = tools.find((t) => t.name === "plan_task")!;
    const result = await tool.execute({ objective: "build UI", steps: ["step1", "step2"] });
    const parsed = JSON.parse(result);
    expect(parsed.objective).toBe("build UI");
    expect(parsed.steps).toHaveLength(2);
  });

  it("advance_task returns not found for unknown task", async () => {
    const tool = tools.find((t) => t.name === "advance_task")!;
    const result = await tool.execute({ taskId: "nonexistent" });
    expect(result).toContain("not found");
  });

  it("task_status returns status for known task", async () => {
    const tool = tools.find((t) => t.name === "task_status")!;
    const result = await tool.execute({ taskId: "task_123" });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("in_progress");
  });
});
