---
name: flux-local
description: Generate images locally via Flux (diffusers) on Apple Silicon MPS.
homepage: https://github.com/black-forest-labs/flux
metadata:
  {
    "ernos":
      {
        "emoji": "🎨",
        "requires": { "bins": ["uv"] },
        "install":
          [
            {
              "id": "uv-brew",
              "kind": "brew",
              "formula": "uv",
              "bins": ["uv"],
              "label": "Install uv (brew)",
            },
          ],
      },
  }
---

# Flux Local (Diffusers on MPS)

Generate images using your local Flux weights via the `diffusers` library on Apple Silicon.

Generate

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "your image description" --filename "output.png"
```

Options

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "a sunset" --filename "sunset.png" --width 1024 --height 1024 --steps 50 --guidance 3.5
```

Configuration

- `FLUX_MODEL_PATH` env var (default: `black-forest-labs/FLUX.1-dev`)
- Weights are loaded from the HuggingFace cache (`~/.cache/huggingface/hub/`)

Notes

- First inference takes 60-120s as weights load into MPS memory.
- The script prints a `MEDIA:` line for ErnOS to auto-attach on supported chat providers.
- Do not read the image back; report the saved path only.
