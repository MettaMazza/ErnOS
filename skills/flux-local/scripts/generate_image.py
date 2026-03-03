#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "diffusers>=0.32.0",
#     "torch>=2.4.0",
#     "transformers>=4.44.0",
#     "sentencepiece>=0.2.0",
#     "accelerate>=1.0.0",
#     "protobuf>=5.0.0",
# ]
# ///
"""
Generate images locally using Flux (diffusers) on Apple Silicon MPS.

Ported from ErnOS 3.0 src/systems/creative/generators.py.

Usage:
    uv run generate_image.py --prompt "your image description" --filename "output.png"
    uv run generate_image.py --prompt "sunset" --filename "sunset.png" --width 1024 --height 1024 --steps 50
"""

import argparse
import os
import sys
from pathlib import Path


def get_device():
    """Detect best available device: MPS (Apple Silicon) > CUDA > CPU."""
    import torch

    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_dtype(device: str):
    """Pick dtype based on device."""
    import torch

    if device == "mps":
        return torch.float16
    if device == "cuda":
        return torch.bfloat16
    return torch.float32


def main():
    parser = argparse.ArgumentParser(
        description="Generate images locally using Flux (diffusers)"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="Image description/prompt"
    )
    parser.add_argument(
        "--filename", "-f",
        required=True,
        help="Output filename (e.g., sunset-mountains.png)"
    )
    parser.add_argument(
        "--width", "-W",
        type=int,
        default=1024,
        help="Image width (default: 1024)"
    )
    parser.add_argument(
        "--height", "-H",
        type=int,
        default=1024,
        help="Image height (default: 1024)"
    )
    parser.add_argument(
        "--steps", "-s",
        type=int,
        default=50,
        help="Number of inference steps (default: 50)"
    )
    parser.add_argument(
        "--guidance", "-g",
        type=float,
        default=3.5,
        help="Guidance scale (default: 3.5)"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed (default: random)"
    )
    parser.add_argument(
        "--model", "-m",
        default=None,
        help="Model path or HF repo (default: FLUX_MODEL_PATH env or black-forest-labs/FLUX.1-dev)"
    )

    args = parser.parse_args()

    # Resolve model path
    model_path = (
        args.model
        or os.environ.get("FLUX_MODEL_PATH")
        or "black-forest-labs/FLUX.1-dev"
    )

    # Set up output path
    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Detect device
    device = get_device()
    dtype = get_dtype(device)
    print(f"Device: {device} | dtype: {dtype} | Model: {model_path}")
    print(f"Generating: {args.width}x{args.height}, {args.steps} steps, guidance {args.guidance}")

    # Import heavy libs after arg parsing
    import torch
    from diffusers import FluxPipeline

    # Load pipeline
    print("Loading Flux pipeline...")
    pipe = FluxPipeline.from_pretrained(model_path, torch_dtype=dtype)
    pipe.to(device)

    # Patch scheduler for MPS IndexError bug (from V3)
    _patch_scheduler(pipe.scheduler)

    print(f"Pipeline loaded. Generating image...")

    # Build generator
    if args.seed is not None:
        generator = torch.Generator("cpu").manual_seed(args.seed)
    else:
        generator = None

    # Generate
    image = pipe(
        args.prompt,
        guidance_scale=args.guidance,
        num_inference_steps=args.steps,
        width=args.width,
        height=args.height,
        max_sequence_length=512,
        generator=generator,
    ).images[0]

    # Save
    image.save(str(output_path))

    full_path = output_path.resolve()
    print(f"\nImage saved: {full_path}")
    # ErnOS parses MEDIA tokens and will attach the file on supported providers.
    print(f"MEDIA: {full_path}")


def _patch_scheduler(scheduler):
    """
    Monkeypatch scheduler.step to catch IndexError at end of generation.
    Ported from ErnOS 3.0 generators.py — fixes an MPS-specific bug.
    """
    if getattr(scheduler, "_is_patched", False):
        return

    original_step = scheduler.step

    def safe_step(model_output, timestep, sample, **kwargs):
        try:
            return original_step(model_output, timestep, sample, **kwargs)
        except IndexError:
            print("Warning: Scheduler IndexError caught (MPS bug). Returning sample as-is.",
                  file=sys.stderr)
            if not kwargs.get("return_dict", True):
                return (sample,)
            from diffusers.schedulers.scheduling_utils import SchedulerOutput
            return SchedulerOutput(prev_sample=sample)

    scheduler.step = safe_step
    scheduler._is_patched = True


if __name__ == "__main__":
    main()
