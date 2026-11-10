# The worked example

`assets/reference-focus-switch.html` is the 72 KB single-file focus-mode switch that this skill was extracted from. It is a complete archetype, not a template to copy verbatim. Read it when you need to see how the five layers fit together; adapt the theme, room and story rather than shipping the same focus switch.

The file is organized by numbered section comments. Search for `0. DOM`, `1. OKLab`, etc.

| Section | What it shows |
|---|---|
| 0 · DOM & math | elements, clamp/lerp/smooth, reduced-motion media |
| 1 · OKLab palette | 5×4 palette, gamut by chroma, time columns, lamp/daylight variants, LUTs, key times, Bayer, stage mix |
| 2 · Geometry | component/capsule/window/lens formulas and resize |
| 3 · Interaction state | one plain state object |
| 4 · Clock | forward/return raw hour, darkness |
| 5 · Story | derived visual state for both roads |
| 6 · Bubbles/messages | spawn, arc, bonk, backlog, flood |
| 7 · Pointer/keyboard | absolute drag, release, ARIA, change, keyboard, announcements |
| 8 · Springs | critical spring, lift, liquid stretch, endpoint kick |
| 10 · Pixel world | buffer/apron, palette-coded pixels, room art, window, desk, shelf, person, rug, light grid |
| 11 · WebGL2 | shader strings, probe, GL setup, uniforms, render, light upload |
| 12 · 2D fallback | capsule clip, world image, shell, translucent lens |
| 13 · Lifecycle | 30 fps world / 60 fps shader, pause, reduced motion, resize, boot |

## Design constants worth keeping

- Stage 16:9; component 60% width, aspect 1.6439; capsule height = compH/1.32, aspect 1.85; shell 4.6%; lens radius = winH/2 − 0.032·capH.
- World core 192×112 + 14 px apron; 20-color OKLab palette; 4 time columns; 4 lighting variants.
- The lens travels between `winX + lensR` and `winX + winW − lensR`; clamp by the stretched radius while dragging.
- The page darkness is the same `night` that drives the palette columns and the shell.
- The story is a pure function of the displayed hour; the slider position only determines the hour.

## What to adapt for a new theme

1. Replace the five base hues and retune the time-column factors; keep the gamut-by-chroma code.
2. Repaint the room from the layout table in `pixel-world.md`; keep the drawing order and material flags.
3. Write a new story map as an idempotent `state(hour)` function; keep the two-road clock shape if the control is reversible.
4. Retheme the shader shell/window colors via uniforms; the optical math is theme-independent.
5. Keep the 2D fallback and the probe/blank guard; they are not theme-specific.
6. Re-run the delivery gate and the screenshot/CDP matrix.

## Decisions that look odd but are deliberate

- The lens is enormous (nearly the window height). It is the hero; the room is composed around it. Do not shrink it “for balance” unless the design asks.
- The person sits at the room centre while the monitor is to the right; this is an over-the-shoulder composition, not a mistake.
- The window outdoors is day-locked at night; it is a painted bright world outside a dark interior, and the lens/window light carries the contrast.
- Emissive screens and lamps use day-locked colors; the room darkens around them.
- A huge lens at the left overlaps the room window; at the right it overlaps the bookshelf. The story is seen around and through it.

## Known rough edges in the artefact

- At 1600×900 the integer scale crops ~5% of the core top/bottom; this is the chosen trade for bigger pixels. If a task forbids cropping, use a cover scale or a larger apron and document the deviation.
- On a 2.5× display the world pixel grid is uneven at a fractional device scale, though edges stay crisp; no bilinear filtering is used.
- The one-time `readPixels` blank guard logs a GPU-stall performance warning in Chromium; expected.
- If you remove the debug query hooks, you lose the fastest way to screenshot an arbitrary story hour; add temporary hooks locally and delete them before delivery.
