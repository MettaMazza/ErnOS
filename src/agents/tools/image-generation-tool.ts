/**
 * Image Generation Tool — ported from V3 tools/system/creative.py generate_image
 *
 * Generates images via OpenAI's DALL-E API. Falls back to
 * other providers if configured.
 */

import * as fs from "fs";
import * as path from "path";
import { artifactRegistry } from "../../memory/artifact-registry.js";

export interface ImageGenerationResult {
  success: boolean;
  path?: string;
  url?: string;
  error?: string;
  provider: string;
}

/**
 * Generates an image using OpenAI's DALL-E API.
 *
 * Requires OPENAI_API_KEY in the environment.
 * Saves the resulting image to the documents directory.
 */
export async function generateImage(params: {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
  quality?: "standard" | "hd";
  model?: string;
  outputDir?: string;
}): Promise<ImageGenerationResult> {
  const { prompt, size = "1024x1024", quality = "standard", model = "dall-e-3" } = params;
  const outputDir = params.outputDir || path.join(process.cwd(), "memory", "images");

  const localApiUrl = process.env.LOCAL_IMAGE_API_URL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey && !localApiUrl) {
    return {
      success: false,
      error:
        "No OPENAI_API_KEY or LOCAL_IMAGE_API_URL configured. Image generation requires either OpenAI API key or a local API URL.",
      provider: "none",
    };
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const sanitizedPrompt = prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
  const filename = `generated_${sanitizedPrompt}_${timestamp}.png`;
  const outputPath = path.join(outputDir, filename);

  if (localApiUrl) {
    // Auto-detect endpoint: if the URL doesn't already include /sdapi/, append the txt2img path.
    // Supports Automatic1111/Forge running local Flux or any SD model.
    const apiUrl = localApiUrl.includes("/sdapi/")
      ? localApiUrl
      : `${localApiUrl.replace(/\/+$/, "")}/sdapi/v1/txt2img`;

    const width = size.startsWith("1792") ? 1792 : 1024;
    const height = size.endsWith("1792") ? 1792 : 1024;

    console.log(`[ImageGen] Generating via Local Forge API: ${apiUrl}`);
    console.log(`[ImageGen] Prompt: "${prompt.slice(0, 120)}..." (${width}x${height})`);

    try {
      // Local Flux generation can take 30-120s depending on hardware — generous timeout.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          prompt,
          negative_prompt: "low quality, worst quality, deformed, distorted, watermark, blurry",
          width,
          height,
          steps: 20,
          cfg_scale: 7,
          sampler_name: "Euler a",
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => "(unreadable)");
        console.error(`[ImageGen] Local API error (${response.status}): ${errBody.slice(0, 500)}`);
        return {
          success: false,
          error: `Local API error (${response.status}): ${errBody.slice(0, 300)}`,
          provider: "local",
        };
      }

      const data = (await response.json()) as { images?: string[] };
      if (!data.images?.[0]) {
        return {
          success: false,
          error: "No image data returned from Local API.",
          provider: "local",
        };
      }

      const buffer = Buffer.from(data.images[0], "base64");
      fs.writeFileSync(outputPath, buffer);
      artifactRegistry.registerArtifact(buffer, { type: "image", prompt, path: outputPath });
      console.log(`[ImageGen] ✅ Image saved: ${outputPath}`);

      return { success: true, path: outputPath, provider: "local" };
    } catch (error: unknown) {
      const err = error as { name?: string };
      const msg =
        err?.name === "AbortError"
          ? "Local image generation timed out after 180s. Is Forge running?"
          : `Local image generation failed: ${String(error)}`;
      console.error(`[ImageGen] ${msg}`);
      return { success: false, error: msg, provider: "local" };
    }
  }

  console.log(
    `[ImageGen] Generating via OpenAI: "${prompt.slice(0, 80)}..." (${model}, ${size}, ${quality})`,
  );

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        quality,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        success: false,
        error: `OpenAI API error (${response.status}): ${errorBody}`,
        provider: "openai",
      };
    }

    // Save to disk (directory already exists)
    const data = (await response.json()) as {
      data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };

    if (!data.data?.[0]) {
      return { success: false, error: "No image data returned from API.", provider: "openai" };
    }

    const imageData = data.data[0];

    if (imageData.b64_json) {
      const buffer = Buffer.from(imageData.b64_json, "base64");
      fs.writeFileSync(outputPath, buffer);
      artifactRegistry.registerArtifact(buffer, { type: "image", prompt, path: outputPath });
    } else if (imageData.url) {
      // Download from URL
      const imgResponse = await fetch(imageData.url);
      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
      fs.writeFileSync(outputPath, imgBuffer);
      artifactRegistry.registerArtifact(imgBuffer, { type: "image", prompt, path: outputPath });
    }

    console.log(`[ImageGen] ✅ Image saved: ${outputPath}`);

    return {
      success: true,
      path: outputPath,
      url: imageData.url,
      provider: "openai",
    };
  } catch (error) {
    return {
      success: false,
      error: `Image generation failed: ${String(error)}`,
      provider: "openai",
    };
  }
}
