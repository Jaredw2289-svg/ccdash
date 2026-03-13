#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUTPUT = ASSETS / "demo.gif"
FONT_PATH = Path("/System/Library/Fonts/Menlo.ttc")

WIDTH = 1440
HEIGHT = 960
WINDOW = (48, 48, 1392, 912)
BODY_X = 92
BODY_Y = 138
LINE_HEIGHT = 31

BG = "#1A1B26"
PANEL = "#24283B"
PANEL_BORDER = "#414868"
TITLE = "#C0CAF5"
GREEN = "#9ECE6A"
BLUE = "#7AA2F7"
CYAN = "#7DCFFF"
YELLOW = "#E0AF68"
WHITE = "#C0CAF5"

LINES: List[Tuple[str, str, int]] = [
    ("$ npx tkusage daily --source all", GREEN, 28),
    ("tkusage: loading all daily data (warm cache, estimated ~4-10s)...", BLUE, 24),
    ("┌────────────┬────────┬──────┬──────────────┬───────────┐", WHITE, 22),
    ("│ Date       │ Source │ Sess │ Models       │ Cost      │", CYAN, 23),
    ("├────────────┼────────┼──────┼──────────────┼───────────┤", WHITE, 22),
    ("│ 2026-03-08 │ Claude │    4 │ • opus-4-6   │   $10.56  │", WHITE, 22),
    ("│            ├────────┼──────┼──────────────┼───────────┤", WHITE, 22),
    ("│            │ Codex  │    1 │ • gpt-5.4    │    $4.83  │", WHITE, 22),
    ("├────────────┼────────┼──────┼──────────────┼───────────┤", WHITE, 22),
    ("│ 2026-03-09 │ Claude │  127 │ • opus-4-6   │   $80.17  │", WHITE, 22),
    ("│            │        │      │ • sonnet-4-5 │           │", WHITE, 22),
    ("│            ├────────┼──────┼──────────────┼───────────┤", WHITE, 22),
    ("│            │ Codex  │    6 │ • gpt-5.4    │   $44.31  │", WHITE, 22),
    ("├────────────┼────────┼──────┼──────────────┼───────────┤", WHITE, 22),
    ("│ Total      │        │      │              │ $1843.80  │", YELLOW, 23),
    ("└────────────┴────────┴──────┴──────────────┴───────────┘", WHITE, 22),
    ("Common commands", GREEN, 22),
    ("  tkusage daily --source all", GREEN, 22),
    ("  tkusage daily --source all --since 2026-03-01 --until 2026-03-09", GREEN, 22),
    ("Star on GitHub: github.com/Jaredw2289-svg/ccdash", GREEN, 22),
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if FONT_PATH.exists():
        return ImageFont.truetype(str(FONT_PATH), size=size)
    return ImageFont.load_default()


def draw_window(draw: ImageDraw.ImageDraw) -> None:
    draw.rounded_rectangle(WINDOW, radius=24, fill=PANEL, outline=PANEL_BORDER, width=3)
    draw.rounded_rectangle((48, 48, 1392, 112), radius=24, fill="#1F2335", outline=PANEL_BORDER, width=3)
    draw.rectangle((48, 90, 1392, 112), fill="#1F2335")
    draw.ellipse((78, 72, 94, 88), fill="#F7768E")
    draw.ellipse((106, 72, 122, 88), fill="#E0AF68")
    draw.ellipse((134, 72, 150, 88), fill="#9ECE6A")
    draw.text((620, 68), "tkusage demo", font=load_font(24), fill=TITLE)


def command_text_for_frame(frame_index: int) -> str:
    command = LINES[0][0]
    typed_chars = min(len(command), max(0, frame_index * 4))
    return command[:typed_chars]


def build_frame(frame_index: int) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw_window(draw)

    draw.text((BODY_X, BODY_Y), command_text_for_frame(frame_index), font=load_font(28), fill=GREEN)
    if frame_index % 2 == 0 and frame_index < 12:
        cursor_x = BODY_X + int(draw.textlength(command_text_for_frame(frame_index), font=load_font(28))) + 2
        draw.text((cursor_x, BODY_Y), "█", font=load_font(28), fill=GREEN)

    visible_count = max(0, frame_index - 7)
    for line_index, (text, color, size) in enumerate(LINES[1:1 + visible_count], start=1):
        y = BODY_Y + 44 + (line_index - 1) * LINE_HEIGHT
        draw.text((BODY_X, y), text, font=load_font(size), fill=color)

    return image


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    frames: List[Image.Image] = []
    durations: List[int] = []

    total_frames = 32
    for frame_index in range(total_frames):
        frames.append(build_frame(frame_index))
        durations.append(120)

    durations[0] = 260
    durations[-1] = 1400

    frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=False,
        disposal=2
    )
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
