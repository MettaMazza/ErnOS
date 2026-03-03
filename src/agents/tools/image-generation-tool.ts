/**
 * Image Generation Tool — ported from V3 tools/system/creative.py generate_image
 *
 * Generates images locally via Flux (diffusers) on Apple Silicon MPS.
 * Spawns the `skills/flux-local/scripts/generate_image.py` script via `uv run`.
 */

import { execFile } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { artifactRegistry } from "../../memory/artifact-registry.js";
import { resolveBundledSkillsDir } from "../skills/bundled-dir.js";

export interface ImageGenerationResult {
  success: boolean;
  path?: string;
  url?: string;
  error?: string;
  provider: string;
}

/**
 * Resolve the path to the flux-local generate_image.py script.
 * Uses ErnOS's standard skill directory resolution (works in dev + bundled builds).
 */
function resolveFluxScript(): string | null {
  const skillsDir = resolveBundledSkillsDir();
  if (skillsDir) {
    const candidate = path.join(skillsDir, "flux-local", "scripts", "generate_image.py");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Generates an image using the local Flux model via diffusers on MPS.
 *
 * Spawns `uv run skills/flux-local/scripts/generate_image.py` as a child process.
 * The script loads FluxPipeline locally — no server or cloud API required.
 */
export async function generateImage(params: {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
  quality?: "standard" | "hd";
  model?: string;
  outputDir?: string;
}): Promise<ImageGenerationResult> {
  const { prompt, size = "1024x1024", quality = "standard" } = params;
  const outputDir = params.outputDir || path.join(process.cwd(), "memory", "images");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const sanitizedPrompt = prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
  const filename = `generated_${sanitizedPrompt}_${timestamp}.png`;
  const outputPath = path.join(outputDir, filename);

  const scriptPath = resolveFluxScript();
  if (!scriptPath) {
    return {
      success: false,
      error:
        "Flux generation script not found. Expected at skills/flux-local/scripts/generate_image.py",
      provider: "local",
    };
  }

  const width = size.startsWith("1792") ? 1792 : 1024;
  const height = size.endsWith("1792") ? 1792 : 1024;
  const steps = quality === "hd" ? 50 : 30;

  // Resolve uv binary path
  const uvBin = process.env.UV_BIN || `${process.env.HOME}/.local/bin/uv`;

  const args = [
    "run",
    scriptPath,
    "--prompt",
    prompt,
    "--filename",
    outputPath,
    "--width",
    String(width),
    "--height",
    String(height),
    "--steps",
    String(steps),
  ];

  // Pass model path if configured
  const modelPath = params.model || process.env.FLUX_MODEL_PATH;
  if (modelPath) {
    args.push("--model", modelPath);
  }

  console.log(`[ImageGen] Generating via local Flux: "${prompt.slice(0, 120)}..." (${width}x${height}, ${steps} steps)`);
  console.log(`[ImageGen] Script: ${scriptPath}`);

  return new Promise<ImageGenerationResult>((resolve) => {
    // Local Flux generation can take 60-180s depending on hardware — generous timeout.
    const child = execFile(
      uvBin,
      args,
      {
        timeout: 300_000, // 5 minutes
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        if (stderr) {
          // Log stderr but don't treat as error — diffusers prints progress there
          for (const line of stderr.split("\n").filter(Boolean)) {
            console.log(`[ImageGen] ${line}`);
          }
        }

        if (error) {
          const msg = error.killed
            ? "Local Flux generation timed out after 5 minutes."
            : `Local Flux generation failed: ${error.message}`;
          console.error(`[ImageGen] ${msg}`);
          if (stdout) {
            console.error(`[ImageGen] stdout: ${stdout.slice(0, 500)}`);
          }
          resolve({ success: false, error: msg, provider: "local" });
          return;
        }

        // Check for MEDIA: line in stdout (ErnOS convention)
        const mediaMatch = stdout.match(/^MEDIA:\s*(.+)$/m);
        const resultPath = mediaMatch ? mediaMatch[1].trim() : outputPath;

        if (!fs.existsSync(resultPath)) {
          console.error(`[ImageGen] Script completed but output file not found: ${resultPath}`);
          resolve({
            success: false,
            error: `Script completed but output file not found: ${resultPath}`,
            provider: "local",
          });
          return;
        }

        // Register artifact
        try {
          const buffer = fs.readFileSync(resultPath);
          artifactRegistry.registerArtifact(buffer, { type: "image", prompt, path: resultPath });
        } catch {
          // Non-fatal — image was still generated
        }

        console.log(`[ImageGen] ✅ Image saved: ${resultPath}`);
        resolve({ success: true, path: resultPath, provider: "local" });
      },
    );

    // Log child process stdout in real-time for progress visibility
    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        console.log(`[ImageGen] ${line}`);
      }
    });
  });
}
