import { describe, expect, it, vi } from "vitest";

// Mock the goals module
vi.mock("../../memory/goals.js", () => ({
  goals: {
    createGoal: vi.fn((title: string, desc: string, parentId?: string) => ({
      id: `goal_${Date.now()}`,
      title,
      description: desc,
      status: "active",
      progress: 0,
      parentGoalId: parentId ?? null,
    })),
    getActiveGoals: vi.fn(() => [
      { id: "goal_1", title: "Learn Music", status: "active", progress: 30 },
    ]),
    updateProgress: vi.fn((goalId: string, progress: number, status?: string) => {
      if (goalId === "nonexistent") {return null;}
      return { id: goalId, progress, status: status ?? "active" };
    }),
  },
}));

const { createGoalsTools } = await import("./goals-tools-def.js");

describe("Goals Tools", () => {
  const tools = createGoalsTools();

  it("returns 3 tool definitions", () => {
    expect(tools).toHaveLength(3);
  });

  it("all tools have name, description, and parameters", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });

  it("goal_create creates a goal and returns its ID", async () => {
    const createTool = tools.find((t) => t.name === "goal_create")!;
    const result = await createTool.execute({ title: "Test Goal", description: "A test" });
    expect(result).toContain("Created Goal:");
    expect(result).toContain("goal_");
  });

  it("goal_list_active returns active goals", async () => {
    const listTool = tools.find((t) => t.name === "goal_list_active")!;
    const result = await listTool.execute({});
    expect(result).toContain("Learn Music");
  });

  it("goal_update_progress updates a goal", async () => {
    const updateTool = tools.find((t) => t.name === "goal_update_progress")!;
    const result = await updateTool.execute({ goalId: "goal_1", progress: 50 });
    expect(result).toContain("Updated Goal goal_1");
  });

  it("goal_update_progress returns not found for unknown goal", async () => {
    const updateTool = tools.find((t) => t.name === "goal_update_progress")!;
    const result = await updateTool.execute({ goalId: "nonexistent", progress: 50 });
    expect(result).toContain("not found");
  });
});
