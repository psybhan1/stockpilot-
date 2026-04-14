#!/usr/bin/env python3
"""
Generate StockPilot's hero background video locally.

Default: CogVideoX-2B (THUDM/CogVideoX-2b). Designed for consumer GPUs —
fits on 8 GB VRAM + 16 GB RAM with CPU offload.

Usage
-----
    python scripts/generate-hero-video.py
    python scripts/generate-hero-video.py --prompt "..."
    python scripts/generate-hero-video.py --model Lightricks/LTX-Video  # if you have the RAM

Output lands at public/hero.mp4 so Next.js serves it at /hero.mp4.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate hero video")
    p.add_argument(
        "--prompt",
        default=(
            "slow abstract flowing ink and light, warm ochre and sage tones, "
            "dark space, soft motion, cinematic, ambient, no text, no faces, "
            "high detail, seamless"
        ),
    )
    p.add_argument(
        "--negative-prompt",
        default="text, watermark, logo, letters, low quality, blurry, noisy, people, face, hands",
    )
    p.add_argument(
        "--model",
        default="THUDM/CogVideoX-2b",
        help="HF model id. Try 'THUDM/CogVideoX-2b' (8GB-friendly) or 'Lightricks/LTX-Video' (needs ~16GB free RAM).",
    )
    p.add_argument("--seconds", type=float, default=3.0)
    p.add_argument("--fps", type=int, default=8, help="CogVideoX outputs 48-frame clips @ 8fps by default.")
    p.add_argument("--width", type=int, default=720)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--steps", type=int, default=30)
    p.add_argument("--guidance", type=float, default=6.0)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dtype", choices=["bfloat16", "float16"], default="float16")
    p.add_argument(
        "--low-vram",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Sequential CPU offload + VAE tiling (default ON for 8 GB GPUs).",
    )
    p.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "public" / "hero.mp4"),
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    try:
        import torch  # type: ignore
        from diffusers.utils import export_to_video  # type: ignore
    except ImportError as exc:
        print(f"Missing dependency: {exc}", file=sys.stderr)
        return 1

    if not torch.cuda.is_available():
        print("CUDA not detected — need an NVIDIA GPU.", file=sys.stderr)
        return 2

    # Pick the right pipeline class based on the model id.
    model_lower = args.model.lower()
    try:
        if "cogvideo" in model_lower:
            from diffusers import CogVideoXPipeline  # type: ignore
            PipelineCls = CogVideoXPipeline
        elif "ltx" in model_lower:
            from diffusers import LTXPipeline  # type: ignore
            PipelineCls = LTXPipeline
        else:
            from diffusers import DiffusionPipeline  # type: ignore
            PipelineCls = DiffusionPipeline
    except ImportError as exc:
        print(f"Pipeline unavailable: {exc}", file=sys.stderr)
        return 1

    dtype = torch.bfloat16 if args.dtype == "bfloat16" else torch.float16
    gpu_name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    print(f"GPU: {gpu_name} · {vram_gb:.1f} GB VRAM · dtype={args.dtype}")
    print(f"Model: {args.model}")

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Frame count constraints vary per pipeline:
    #   - CogVideoX: fixed at 49 frames (internal)
    #   - LTX-Video: 8n+1
    if "cogvideo" in model_lower:
        num_frames = 49
        print(f"CogVideoX generates a fixed 49-frame clip @ {args.fps}fps (~{49 / args.fps:.1f}s).")
    else:
        target = max(1, int(round(args.seconds * args.fps)))
        num_frames = ((target - 1) // 8) * 8 + 1
        if num_frames != target:
            print(f"Rounded frame count from {target} to {num_frames} (LTX needs 8n+1).")

    print("Loading pipeline…")
    pipe = PipelineCls.from_pretrained(
        args.model,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
    )

    if args.low_vram:
        print("Low-VRAM mode: sequential CPU offload + VAE tiling.")
        pipe.enable_sequential_cpu_offload()
        try:
            pipe.vae.enable_slicing()
            pipe.vae.enable_tiling()
        except AttributeError:
            pass
    else:
        pipe.to("cuda")

    generator = torch.Generator(device="cpu").manual_seed(args.seed)

    print(
        f"Generating {args.width}x{args.height} · {num_frames} frames · "
        f"steps={args.steps} · guidance={args.guidance} · seed={args.seed}"
    )
    print("(May take several minutes on 8 GB VRAM.)")

    kwargs = dict(
        prompt=args.prompt,
        width=args.width,
        height=args.height,
        num_frames=num_frames,
        num_inference_steps=args.steps,
        guidance_scale=args.guidance,
        generator=generator,
    )
    if "cogvideo" not in model_lower:
        kwargs["negative_prompt"] = args.negative_prompt

    result = pipe(**kwargs)
    frames = result.frames[0]

    print(f"Writing → {out_path}")
    export_to_video(frames, str(out_path), fps=args.fps)

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Done. {size_mb:.1f} MB.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
