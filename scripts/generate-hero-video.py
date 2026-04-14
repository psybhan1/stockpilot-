#!/usr/bin/env python3
"""
Generate StockPilot's hero background video locally with LTX-Video.

Usage
-----
    python scripts/generate-hero-video.py \
        --prompt "slow abstract ochre ink drifting through dark space, cinematic" \
        --seconds 6 \
        --out public/hero.mp4

Requirements (install once)
---------------------------
    pip install --upgrade torch torchvision  # CUDA build, pick from pytorch.org
    pip install --upgrade \
        diffusers transformers accelerate sentencepiece imageio imageio-ffmpeg

GPU VRAM
--------
    LTX-Video runs on ~12-16 GB at 768x512 @ 24fps for a ~6s clip.
    Add --dtype float16 if you're tight. Drop --height/--width for smaller.

What this script does
---------------------
    1. Loads a LTX-Video diffusion pipeline from Hugging Face. The default
       checkpoint is Lightricks/LTX-Video (latest on the Hub) — override
       with --model if you have a newer local checkpoint (e.g. ltx-2.3).
    2. Runs text-to-video inference with the given prompt.
    3. Writes an H.264 mp4 next to the app's public/ directory so Next.js
       serves it at /hero.mp4 with no config changes.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate hero video with LTX-Video")
    p.add_argument(
        "--prompt",
        default=(
            "slow abstract ink drifting through dark space, warm ochre and "
            "sage tones, soft light rays, cinematic, high detail, seamless loop"
        ),
        help="Text prompt describing the video.",
    )
    p.add_argument(
        "--negative-prompt",
        default="text, watermark, logo, letters, low quality, blurry, noisy",
    )
    p.add_argument("--model", default="Lightricks/LTX-Video")
    p.add_argument("--seconds", type=float, default=6.0)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--width", type=int, default=768)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--steps", type=int, default=40)
    p.add_argument("--guidance", type=float, default=3.0)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dtype", choices=["bfloat16", "float16"], default="bfloat16")
    p.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "public" / "hero.mp4"),
        help="Output MP4 path. Default: public/hero.mp4 (served at /hero.mp4).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    try:
        import torch  # type: ignore
        from diffusers import LTXPipeline  # type: ignore
        from diffusers.utils import export_to_video  # type: ignore
    except ImportError as exc:
        print(
            "Missing dependency: %s\n"
            "Install with:\n"
            "  pip install --upgrade diffusers transformers accelerate "
            "sentencepiece imageio imageio-ffmpeg torch torchvision"
            % exc,
            file=sys.stderr,
        )
        return 1

    if not torch.cuda.is_available():
        print(
            "CUDA not detected. LTX-Video needs a GPU.\n"
            "If you have an NVIDIA card, install the CUDA PyTorch build from "
            "https://pytorch.org/get-started/locally/ and rerun.",
            file=sys.stderr,
        )
        return 2

    dtype = torch.bfloat16 if args.dtype == "bfloat16" else torch.float16
    device = "cuda"

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # num_frames must be (multiple of 8) + 1 for LTX. Enforce that here.
    target = max(1, int(round(args.seconds * args.fps)))
    num_frames = ((target - 1) // 8) * 8 + 1
    if num_frames != target:
        print(f"Rounded frame count from {target} to {num_frames} (LTX requires 8n+1).")

    print(f"Loading {args.model} in {args.dtype}…")
    pipe = LTXPipeline.from_pretrained(args.model, torch_dtype=dtype)
    pipe.to(device)

    # Memory-save toggles. Keep VAE slicing on for mid-range cards.
    try:
        pipe.vae.enable_slicing()
        pipe.vae.enable_tiling()
    except AttributeError:
        pass

    generator = torch.Generator(device=device).manual_seed(args.seed)

    print(
        f"Generating {args.width}x{args.height} @ {args.fps}fps · "
        f"{num_frames} frames ({num_frames / args.fps:.1f}s) · seed={args.seed}"
    )
    result = pipe(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        width=args.width,
        height=args.height,
        num_frames=num_frames,
        num_inference_steps=args.steps,
        guidance_scale=args.guidance,
        generator=generator,
    )

    frames = result.frames[0]
    print(f"Writing → {out_path}")
    export_to_video(frames, str(out_path), fps=args.fps)

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Done. {size_mb:.1f} MB.")
    print("\nNext step: reload the app. The hero component falls back to the")
    print("generative ink canvas if the video is missing, so you can iterate")
    print("on prompts and just overwrite /public/hero.mp4 each time.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
