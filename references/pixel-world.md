# The pixel world

The room is drawn every frame into a small material buffer, then resolved to color. It is not a static image. Keep the buffer small enough that this is cheap (e.g. 220×140 total), and keep the drawing code declarative so poses and story can change without repainting the whole scene by hand.

## Contents
1. Buffer, apron and coordinates
2. Primitives that pay for themselves
3. Structural layers
4. A proven 192×112 study layout
5. Window, outdoors, sash, blinds
6. Desk, monitor, lamp, small objects
7. Bookshelf
8. Rug, sunlight, steam, dust, message bubbles
9. The person (back view and walking)
10. Story state as a pure function of hour
11. The light grid
12. Performance and debugging

## 1. Buffer, apron and coordinates

Use a core area (the room) plus an apron on every side. The apron is what the lens sees when it is near the capsule edge; without it, refraction compresses clamped pixels into flat streaks.

```js
const MX = 14, MY = 14;            // apron
const CW = 192, CH = 112;          // core
const WW = CW + MX*2, WH = CH + MY*2;
const buf = new Uint8Array(WW*WH); // material codes
```

All drawing functions take **core coordinates** (`0..191`, `0..111`) and add `MX/MY` internally. A single offset keeps the room layout readable in code and lets the apron be painted by simply extending the structural bands past the core.

## 2. Primitives that pay for themselves

```js
function px(x,y,code)             // clipped set
function rect(x,y,w,h,code)       // clipped fill
function ell(cx,cy,rx,ry,code)    // filled ellipse
function line(x0,y0,x1,y1,code)   // Bresenham
function limb(x0,y0,x1,y1,w,code) // 2px-ish slanted limb, one row at a time
function setVar(x,y,variant)      // only change the lighting bits
```

`setVar` is the workhorse for lighting: draw the room normally, then walk an ellipse/parallelogram and *change only the variant* of pixels already there. This is how the lamp pool, wall wash and floor sunlight are applied without redrawing the objects.

Store one byte per pixel: `material | (variant<<5) | (dayLock?128:0)`. Use a second array only if profiling says the bit packing is awkward; 220×140 is small enough to keep it simple.

## 3. Structural layers

Draw in this order:

1. fill the entire buffer with wall (also fills the apron)
2. ceiling/crown (extend above the core)
3. wainscot + seams + baseboard
4. floor planks (extend below the core)
5. window recess/frame + the outdoor scene
6. wall art
7. bookshelf
8. rug
9. sunlight patch + dust
10. desk + all desk objects
11. chair
12. person (or walker)
13. lamp pool / light overlays
14. message bubbles, embers, foreground particles

A floor with **widening plank rows** toward the viewer reads as perspective. Build the rows from a height list (`1,1,2,2,3,3,4,5,6,7,…`), alternate two wood tones, draw a dark seam at each row top, and add vertical joints at a staggered x per row. A single flat orange rectangle will not read as a floor.

Wainscot: a light panel color, a 1px seam every 8px, a darker rail at the top/bottom, then a 4px baseboard. This frame is what makes the room feel built rather than drawn.

## 4. A proven 192×112 study layout

These coordinates produced a balanced, readable room. Use them as a starting point, not a law; the relationships matter more than the exact numbers.

| Element | Placement (core) |
|---|---|
| Ceiling | `y < 4`; crown line `y 4–5`, shadow `y 6` |
| Wall | cream, `y 7–73` |
| Wainscot | `y 74–91`, seam every 8px; baseboard `y 92–95` |
| Floor | `y ≥ 96`, planks widen downward |
| Window glass | `x 22–60`, `y 20–62`; 3px white frame → outer `19–63 × 17–65`; sill `y 66–67` |
| Window sash | lower sash slides up ~19px; top rail at `38 − open*19` |
| Blinds | descend from `y 20`, 2 slat rows + 1 light row per 3 |
| Sill plant | pot `x 47–53`, `y 62–65`, leaves above |
| Wall picture | `x 76–92`, `y 24–36` |
| Desk top | `y 70–72`, `x 68–157`; front apron/edge darker |
| Desk leg | `x 69–71`, `y 73–95` |
| Drawer unit | `x 140–158`, `y 73–95`, 3 drawers |
| Monitor | screen `x 113–136`, `y 47–61`, bezel 2px, stand to desk |
| Lamp | `x 147`; base `143–151`, pole `147–148`, shade `y 52–55` |
| Phone | `x 71–77`, `y 66–69` |
| Cup | `x 80–84`, `y 64–69` |
| Headphones | `x 136–143` on the desk when off |
| Chair center | `x 96`; back `y 59–84`, seat `y 81–84`, lift/base below |
| Bookshelf | `x 162–190`, `y 32–95`; 4 compartments; plant on top |
| Rug | ellipse center `(96,101)`, `rx 39`, `ry 5` |

The person sits at `x 96`; the monitor is to the viewer's right. That's an over-the-shoulder composition: we see the back of the head/shoulders, the desk, and the screen. Don't try to put the person in front of the monitor.

## 5. Window, outdoors, sash, blinds

Draw the **outdoors clipped to the glass rect**, always with day-locked colors:

- sky: a pale blue muted step; a slightly deeper band near the horizon
- far ridge: a sine ridge line, 2–3px wide variation, snow caps as a few bright pixels
- near hills, grass
- a small house: roof triangle, chimney, wall, two windows, door
- two round trees, trunks, a highlight on the canopy
- clouds: 2–3 blobs drifting at different speeds, wrapping
- birds: occasional 1px “v”, not every frame
- a faint diagonal glass reflection line

Sash: a white rail at `38 − open*19`, a bottom rail at `61 − open*19`, 2px stiles; below the moving bottom rail the outdoors is unobstructed. Blinds overlay the glass: rows `i%3===2` are a bright day strip, the others are slat + shadow. A bottom rail only when partially down. The plant on the sill is drawn *after* the blinds and sways with `sin(time*2.2)*open`.

A 39×43 glass area is enough for a complete landscape; resist adding more objects. Three depth bands plus one house and two trees reads.

## 6. Desk, monitor, lamp, small objects

- **Monitor screen** is both an object and a UI. Draw a header bar, 3–4 chat/message rows or 6–9 code lines, and a blinking cursor. Use day-locked colors: it must remain the brightest thing in a night room. Do not draw readable text; 1px bars at varying indents and colors are enough.
- **Lamp**: base, pole, a diagonal arm, trapezoid shade. When on, the shade is day-locked amber and a dithered radial halo warms nearby surfaces. When off, use the time color so it recedes.
- **Phone**: 5×3 body; lit screen and a 2px badge at top-right when a message lands. A 1px vibration offset for ~0.2s is enough.
- **Cup**: 5×5 white body, a 1px handle, coffee line. Steam above it as 1px dithered wisps, not a plume.
- **Headphones prop** disappears when the person wears them; draw them at the head instead.
- **Desk light** is a `lamp`-variant ellipse over the desk plus a `daylight`-variant ellipse on the wall (same tone, one step brighter). The warm color is the pixel-level lamp variant; the wall stays its own hue.

## 7. Bookshelf

A dark back panel makes the books pop; a warm wood frame ties it to the desk. Draw 2px verticals, 2px shelves, then books as 1–3px wide bars with 5–11px heights, alternating families and a 1px top highlight. Leave gaps and one leaning/horizontal stack. A basket is a trapezoid with 1px weave lines; the kettle is a rounded body + spout + handle; the bean jar is a glass rectangle with beans at the bottom and a lid. A plant on top with a vine trailing down one side is a strong silhouette.

Do not fill every shelf completely; the empty gaps are what read as shelves.

## 8. Rug, sunlight, steam, dust, message bubbles

- **Rug**: ellipse with a darker border ring and a sparse pattern of 1px accents. Keep the palette families consistent with the room (muted blue-blue with amber flecks works).
- **Sun patch**: a slanted parallelogram projected from the window; use the `daylight` variant only on existing floor/rug pixels. When blinds are down, keep only a 1-in-3 stripe of source rows. A soft dithered edge is better than a hard shape.
- **Dust**: 5–8 1px day-locked pixels drifting inside the patch. Multiply by day factor; never at night.
- **Steam**: 4–6 1px pixels per source, rising 8px, drifting ±2px, with a Bayer threshold proportional to remaining life. Draw behind/over the cup depending on the scene.
- **Message bubble**: a 5–7px white rounded body with 2–3 dark dots and a tail. Animate it from the window to the phone on a quadratic arc; grow the size from ~0.15 to 1. When the glass is shut, switch it to a “bonk” state: 1 frame flash, squash, slide down, fade via dither.
- **Blocked-message backlog** is state, not a visual; the return story can replay it as a burst.

## 9. The person

### Back view, seated
- 9px-wide black/navy hair block; cut the four corners to the wall color to suggest an oval; one 2–3px lighter sheen at the top-left.
- ears 1px skin at each side at hair mid-height; a 3px neck below; shoulders 13–15px; a shirt with a darker right edge and a lighter left edge; a 1px back seam.
- chair back is blue-grey, *behind* the person; leave 2px visible at each side. A too-dark chair merges with the hair; a green chair merges with the shirt.
- headphones: 2px band across the top, 2–3px cups at both sides, a 1px dark outline and a **day-locked white glint** so the cans still read at night.
- typing: elbows alternate ±1px at a phase rate derived from the typing speed. Hands can be hidden by the torso; the elbows sell it.
- rim light: at night, 1px grey-blue on the right of the hair and right shoulder.
- head turn: shift the head 1px and add a skin sliver + an eye pixel on the leading side. Blink by hiding the eye for ~0.12s.
- stretch: arms up over the head, two limbs from the shoulders to above the hair, hands as 2–3px skin blocks (not floating).
- surprise: “!” above the head, head up 2px, headphones to the neck.

### Side view, walking
- head 7px, body 7px, legs 2px wide with a 2–3px stride, shoes 3px, arm swing opposite the legs.
- `face` sign flips the hair mass to the back and the eye/nose to the front.
- Carrying a cup: a 3px cup at the front hand with a steam wisp.
- At the shelf, raise one arm to the kettle height; the hand should be at kettle height, not above the shelf.

A 1px limb disappears against a busy bookshelf; always draw limbs 2px wide with a contrasting family.

## 10. Story state as a pure function of hour

Compute the hour first, then derive visual values. This makes scrubbing safe and lets you add time-based particles on top without a second state machine.

Forward road (12:00 → 23:4):
```
open    = 1 - smooth(15.2, 15.9, h)
blinds  = smooth(16.0, 19.2, h)
hp      = smooth(14.0, 14.75, h)       // headphones on
code    = smooth(14.55, 14.8, h)       // screen crossfade
typing  = h >= 15.4
rate    = h >= 21.5 ? 14 : 8
lean    = smooth(21.3, 21.65, h)
steam   = 1 - smooth(19.5, 22.6, h)
lamp    = h >= 18.4 (with two flashes on entry)
```

Back road (t = h − 24, 0 → 12):
```
open    = smooth(7.0, 7.7, t)
blinds  = 1 - smooth(1.4, 3.4, t)
lamp    = 1 - smooth(1.55, 1.85, t)
hp      = 1 - smooth(0.45, 0.85, t)
stretch = t < 1.4 ? sin((t/1.3)*PI) : 0
speech  = t >= 7.7
walk:    t 3.8–4.75 to shelf, 4.75–6.6 at shelf, 6.6–7.35 back
kettle  = 4.55 < t < 6.75
cup     = on shelf 4.75–6.6, carried 6.6–7.35, on desk otherwise
```

At the right end, the clock can drizzle 21.5 → 23.4 over 26s. Don't let the story pop when the road changes; make both roads equal at noon.

## 11. The light grid

72 columns (1D horizontally) is enough for a room of this size and keeps the B-spline cheap.

- Add emitters by x-range and weight: window (scale by daylight and `1-blinds`), lamp, monitor, phone, and blind light strips.
- Blur twice radius 1, then twice radius 3 ×0.55. Preserve alpha/weight.
- Store either premultiplied color (RGB) or color + weight; the shader wants a screen-blend color. Upload as RGBA8 72×1.
- The lamp's x/strength also warms the shell and leaks outside the capsule; pass them as uniforms.

## 12. Performance and debugging

- Redraw the world at 30fps; update the shader at display rate. Keep `worldDirty/lightDirty` flags and upload only on change.
- Cache the palette LUT and the material table. No per-pixel object lookups.
- Use the ASCII inspector from `references/verification-and-diagnosis.md` to see the room: map each screenshot block to the nearest palette color and print characters. It catches a missing head, a chair that reads as a body, a blank screen, or a shelf full of orange.
- Placeholder time: a single static frame of the room should already tell the story of the scene. Animate after it reads.
