---
name: pixel-art-webgl-component
description: Build or repair a single-file pixel-art web component composited in WebGL2 — 像素房间、液态玻璃透镜、像素风开关/滑块, OKLab palettes, Bayer-dithered time-of-day lighting, painted shells, light fields and story-driven interactions. Use this skill whenever the user asks for pixel art in a webpage, a pixel room/diorama, a stylized toggle or slider, a glass/lens/refraction effect, a retro single-file canvas/shader artifact, or says the page doesn't display, is blank/beige, cropped, blurry on high-DPI, or broke in a preview; also for Chinese requests like 像素风、像素房间、液态玻璃、专注模式开关、网页组件、没显示/白屏/发虚.
---

# Pixel-art WebGL component

This skill is for **design-object web components**: a tiny painted world, a physical shell, and one optical hero (a liquid glass lens) that the user can move through a story. The result must be one self-contained HTML file, crisp at any size, and alive without being noisy.

The sample that produced this skill was a focus-mode switch: a 192×112 pixel study inside a capsule, a huge liquid-glass lens as the slider, two time-of-day roads (noon→night and midnight→noon), and an accessible `role="switch"`.

The hard part is not any single shader. It is keeping **five coordinate systems, a palette, a story clock, and an accessible control** consistent at the same time. Work in the order below; do not start with the shader.

## Delivery contract

- **One `.html` file.** No external fonts, images, libraries, network requests, or build step at runtime.
- **A fixed stage, not a loose page.** The component lives in a centered 16:9 stage; the component is a known percentage of it. Everything else is negative space.
- **No visible copy.** The only text may be an ARIA label / live-region text, which is visually hidden.
- **Pixels never blur.** Integer pixel scale for the world; nearest sampling; no CSS upscaling of the canvas below device resolution.
- **Remove debug hooks before delivery** (`?x=`, `?t=`, `?world=`, dump titles, test clickers). Leave no scratch files next to the artifact.
- **A blank page is a viewer problem until proven otherwise.** If only the stage background shows, read `references/verification-and-diagnosis.md` before editing the code. On Windows the `.html` default handler can be Internet Explorer, and chat/file previews may run the page with scripts disabled. Open the file explicitly in Chrome/Edge.

### Working on a 1,500–2,500-line single file

During development, split it into ordered parts (CSS/head, palette+state, world, shader/GL, app loop, tail) and concatenate them with a tiny build command. Add temporary debug hooks — a raw-world view, fixed-hour and fixed-position params — to inspect exact states. For delivery, strip the hooks, concatenate once, delete the parts/build script, and keep only the HTML. This gives you editability without ever shipping a multi-file page; don't try to maintain the finished 2,000-line file by scrolling.

## Architecture: three layers plus a fallback

1. **Pixel world** — an offscreen 2D canvas, core size + an apron (e.g. 192×112 + 14px all around). Draw with material IDs and lighting flags, not raw colors. Resolve to colors at 30 fps, using per-pixel Bayer dithering between time-of-day columns. This layer is the art; it must read even as a still.
2. **WebGL2 compositor** — one full-screen fragment shader over the component. It samples the world texture with `texelFetch` (crisp), then paints the shell, the recessed window, the lens, the light field, shadows and grain. The lens refracts the same world texture, so it can be composed analytically without framebuffer feedback.
3. **DOM control** — a transparent `<button role="switch">` shaped/positioned over the capsule. It owns pointer capture, keyboard, ARIA, `change`, and the live region. It must not block the canvas visually.
4. **2D fallback** — draw the world through a capsule clip, plus a translucent round thumb, when WebGL2 or the shader is unavailable. Keep it good enough to ship; do not leave a blank canvas.

## Workflow

### 0. Lock the geometry before the art
Write the stage/component/capsule numbers in one place, in **CSS pixels**, and use percentages for the DOM button so it tracks resize:

```
component aspect ≈ 1.6439; capsule H = compH/1.32; capW = 1.85·capH
shell = 0.046·capH; winH = capH − 2·shell; winW = capW − 2·shell
lensR = winH/2 − 0.032·capH
```

The window is a stadium (rounded rect with radius = half its height). The lens is a circle inside it, with a travel range inset by its radius. Check that the circle actually fits the stadium at both ends before building the shader.

### 1. Build the palette and its time columns
Use OKLab, not HSL. Convert the base colors, set lightness, and **reduce chroma until the color is in sRGB gamut**; do this once at startup. Store four time columns (day/dusk/evening/night) and four lighting variants (normal/shadow/lamp/daylight) per palette entry. Pack everything into `Uint32Array` LUTs.

Then use **4×4 Bayer dithering, never a blend**, between adjacent key times. Outside views and emissive screens must be day-locked so they do not dim with the room. Details and code: `references/palette-and-dither.md`.

### 2. Paint the world into a material buffer
Draw structure first (ceiling, wall, wainscot, floor), then the window/outdoors, wall art, furniture, chair, person, rug, and finally light overlays. Store `(material, variant, dayLock)` per pixel; resolve to color only once per frame. Keep the world at 30 fps, independent of the display refresh rate.

For a person seen from behind: hair block ~9 px wide, a 1 px sheen, two ears, a 3 px neck, shoulders 13–15 px, a low chair back, and elbows that alternate 1 px. A single flat black rectangle reads as furniture; the neck, ears and a hair sheen are what make it read as a person. For side-view walking, use 2 px-wide limbs and a small stride; 1 px limbs disappear against a busy shelf.

The study layout, drawing recipes and the character/light overlays are in `references/pixel-world.md`.

### 3. Make the world legible before compositing
Screenshot the raw world at an integer zoom and inspect it. A powerful trick when you cannot see images: map each screenshot block back to the nearest palette color and print a character map (see `references/verification-and-diagnosis.md`). Use it to check the window, monitor, chair, head, shelf and rug silhouettes. Fix the art here; no shader can rescue an unreadable room.

### 4. Build the light field
Accumulate emissive pixels/objects into a 72-column grid, blur twice at radius 1, then twice at radius 3 × 0.55, and sample it in the shader with a cubic B-spline. Screen-blend it onto both the window and the lens. Use the lamp's position and strength to warm the shell and leak onto the page. The grid is 1D horizontally; do not turn it into a full 2D smear.

### 5. Write the compositor
In this order, in one fragment shader:
- capsule SDF and inner window SDF
- outside: two soft drop shadows + warm leak
- shell: rounded bevel normal, Fresnel + studio softbox/fill, base color mix, inner-edge darkening, lamp warmth
- window: world sample, top inner shadow, dark rim, faint diagonal glass sheen
- lens: flat 1.24× center, outer ~30% warp that compresses the surroundings in, ~5% chromatic dispersion, cast shadow (bigger while pressed), bottom inner caustic, soft top reflections, edge darkening for thickness
- light field as a screen blend
- ±0.75/255 noise
- anti-aliased capsule edge

Use `texelFetch` for the world. Compute the world mapping from the window rect so the *core* is centered and the apron supplies the "outside" the lens can see. Details, formulas and shader structure: `references/webgl-optics.md`.

### 6. Separate clock, story and pose
Do not drive animations directly from the slider. Compute an unwrapped hour from the position (separate forward and return roads), then derive an idempotent visual state from that hour. This makes scrubbing, clicking and reduced-motion all consistent.

The return road is not the forward road reversed: model it as `mix(36, departureHour, x)`, then take the displayed hour modulo 24, so it walks 23.4→24→0→12. The darkness is a function of that displayed hour. Keep the two roads' boundary states deliberately equal (noon) or the loop will pop.

### 7. Add physical feel, then accessibility
- Drag: absolute pointer position with a grab offset, exponential follow (~34/s), release target from position + velocity (clamped).
- Release: critically damped spring (ω 9.5; 16 with reduced motion).
- Lens: press lift (exp 14), radius +1.2%, under-damped stretch (k 170, c 11) driven by |velocity|·0.42, sx=1+0.2s, sy=1−0.075s; a kick at the endpoints.
- Click toggles; arrow keys move 4%; ARIA checked; bubble a `change` event; announce phases through a visually hidden live region.
- Reduced motion: no stretch, no scare, no particles, and stop drawing when idle. Pause offscreen and when hidden.
- Fallback: WebGL2 unavailable **or** the shader fails. Probe on a throwaway canvas first; if the visible canvas already has a failed WebGL context, replace it with a fresh canvas before trying 2D.

Full formulas and the accessibility checklist: `references/interaction-and-a11y.md`.

### 8. Verify like a user, then like a machine
1. Open in Chrome/Edge, not the OS default .html handler.
2. Headless screenshot at 1280×720, 1600×900 and 1920×1080; check the crop, the shell and the lens at both ends.
3. Reduced-motion and no-WebGL screenshots.
4. CDP-driven real click/drag/keyboard: read `aria-checked`, the live region, and the stage background before/after; capture console errors.
5. Static checks: parse the inline script (`node --check`), assert zero external refs, zero debug hooks, one file.

Reusable scripts are in `scripts/`. The blank/beige decision tree, the Windows IE trap, high-DPI blur, virtual-time caveats and the CDP recipe are in `references/verification-and-diagnosis.md`.

## Craft rules that are easy to get wrong

- **Integer pixel scale is not enough if the CSS canvas size is fractional.** Back the canvas by `round(cssSize × dpr)`, use full `devicePixelRatio` (don't cap at 2 on a 2.5× screen), and set `image-rendering: pixelated`. A sub-pixel canvas scaling makes the whole thing look soft.
- **Explicit fallback heights.** A 16:9 stage with `aspect-ratio` is fine in modern browsers; in embeds/previews `aspect-ratio` or `min()` can fail and collapse the canvas to 0. Set `height:min(100vw*9/16,100vh)` and a percentage height on the component as well.
- **WebGL contexts lock a canvas.** If shaders fail after `getContext('webgl2')`, `getContext('2d')` returns null forever. Compile a probe on a 4×4 throwaway canvas first; if the real context still fails, replace the canvas before falling back.
- **Reversed `smoothstep(hi, lo, x)` is undefined.** Write `1.0 - smoothstep(lo, hi, x)`. Some drivers tolerate it; others produce garbage.
- **A successful shader can still render nothing.** Read one pixel at the capsule center after the first draw; if alpha is 0, swap to the 2D path.
- **`color-mix` and CSS variables in calcs are progressive enhancements.** Compute the stage's OKLab mix in JS as well so the page still darkens where CSS support is missing.
- **A "glass" edge should darken, not glow.** Bright rims read as plastic. The one warm exception is the lower inner caustic explicitly requested by the design.
- **Emissive surfaces must be day-locked.** If the monitor, phone, lamp bulb or outside view dims with the room, the night scene loses its light source and looks dead.
- **Lens distortion needs the surrounding image.** Render an apron around the core; otherwise the rim compresses clamped edge pixels into flat streaks.
- **Don't trust a visual description of a 9 px character.** Verify the head, chair and shelf with a pixel map.

## References

Read only what you need.

| File | Use when |
|---|---|
| `references/palette-and-dither.md` | Building the OKLab palette, time columns, lighting variants, Bayer key times, day-locked pixels |
| `references/pixel-world.md` | Painting the room, layout coordinates, window/desk/shelf/person recipes, light grid, story states |
| `references/webgl-optics.md` | Capsule/shell/window/lens shader math, scaling rule, light-field B-spline, shadows, noise |
| `references/interaction-and-a11y.md` | Drag/spring physics, two-road clock, ARIA/change/live region, reduced motion, fallbacks |
| `references/verification-and-diagnosis.md` | Headless screenshots, CDP tests, ASCII pixel inspection, blank/beige decision tree, IE/DPR traps |
| `references/worked-example.md` | How to read the 72 KB worked example: section map, constants, what to adapt, deliberate oddities |
| `assets/reference-focus-switch.html` | The complete worked example: palette, world art, shell/window/lens shader, light field, two-road story, interaction, 2D fallback. Use it as an archetype; search its numbered section comments and adapt the content, don't copy the theme blindly. |
| `scripts/shot.ps1` | Robust headless Chrome screenshots (GPU/SwiftShader/2D/reduced-motion/viewport) |
| `scripts/chrome-cdp.ps1` + `scripts/cdp-probe.mjs` | Launch a debug Chrome and drive real clicks/keys/screenshots |
| `scripts/verify-html.mjs` | Static delivery gate: inline-script syntax, self-containment, debug leftovers, single file |

## Quality bar

- The room reads as a room in 1 second at 60% of a 1600-wide stage.
- The person reads as a person, not a chair, at the default state.
- The lens is the hero: flat center, bent rim, dispersion, cast shadow, caustic.
- Night is dark, warm where the lamp/screen is, and the outside stays bright.
- The component snaps to either end and the story is legible in both directions.
- It still renders (2D) when WebGL2 is broken, and it is still usable with reduced motion.
- One file; no network; no visible labels; no debug hooks.
