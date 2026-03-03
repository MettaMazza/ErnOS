/**
 * Science Tool — Exposes the Science Engine to ErnOS agent system.
 *
 * Provides a `science_compute` tool for STEM calculations:
 * - evaluate: math expressions (instant via math.js)
 * - solve: symbolic algebra (Python/SymPy)
 * - matrix: matrix operations
 * - stats: statistical analysis
 * - physics: constants + unit conversions
 * - chemistry: periodic table lookups
 * - code: sandboxed Python execution
 * - auto: auto-detect best mode
 */
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";

export function createScienceTool(): AnyAgentTool {
  return {
    name: "science_compute",
    label: "Science Compute",
    description:
      "Perform scientific computation. Modes: " +
      "'evaluate' (math expressions like '2+2', 'det([[1,2],[3,4]])', 'sqrt(144)'), " +
      "'solve' (symbolic algebra via SymPy like 'x**2 - 4'), " +
      "'matrix' (matrix operations like 'det([[3,1],[5,2]])'), " +
      "'stats' (statistics on data like '[1,2,3,4,5]'), " +
      "'physics' (constants like 'speed of light' or unit conversion like '5 km to miles'), " +
      "'chemistry' (element lookup like 'Carbon' or 'Fe'), " +
      "'code' (sandboxed Python for complex computation), " +
      "'auto' (auto-detect best mode). " +
      "Use 'auto' when unsure which mode to use.",
    parameters: Type.Object({
      mode: Type.String({
        description:
          "Computation mode: evaluate, solve, matrix, stats, physics, chemistry, code, or auto. Use 'auto' to auto-detect.",
        default: "auto",
      }),
      expression: Type.String({
        description:
          "The expression, query, or code to compute. " +
          "For 'evaluate': math expression (e.g. '2^10 + sqrt(144)'). " +
          "For 'solve': equation to solve (e.g. 'x**2 - 4'). " +
          "For 'chemistry': element name or symbol (e.g. 'Carbon', 'Fe'). " +
          "For 'code': Python code (sandboxed, pre-imports numpy/scipy/sympy).",
      }),
    }),
    async execute(_toolCallId: string, args: unknown) {
      const { mode, expression } = args as { mode: string; expression: string };

      // Dynamic import to avoid loading science engine at startup
      const { compute } = await import("../../science/science-engine.js");
      type ScienceMode = Parameters<typeof compute>[0]["mode"];

      const result = await compute({
        mode: mode as ScienceMode,
        expression,
        timeout: 10,
      });

      const text = result.success
        ? `[${result.mode}/${result.layer}] ${result.result}`
        : `Science compute error (${result.mode}): ${result.error}`;

      return { content: [{ type: "text" as const, text }], details: {} };
    },
  };
}
