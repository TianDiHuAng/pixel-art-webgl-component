# Feel, interaction, clock, and accessibility

A beautiful still is half the job. The component must feel physical, behave predictably from mouse, touch and keyboard, and not rely on the user being able to see the animation.

## Contents
1. Interaction state
2. Drag that “follows the hand”
3. Release and the critically damped spring
4. The lens as a spring (lift, stretch, endpoints)
5. Position → clock (two roads)
6. Story phases and announcements
7. ARIA, change events, keyboard
8. Reduced motion and pausing
9. The 2D fallback
10. Checklist

## 1. Interaction state

Keep one plain object:

```js
{
  pos: 0,              // displayed slider 0..1
  target: 0,
  vel: 0,
  drag: false, dragging: false,
  grabOff: 0,          // pointer offset from the knob centre at pointerdown
  dragTarget: 0,       // absolute target under the finger
  lift: 0,             // press lift 0..1
  stretch: 0, stretchV: 0,
  mode: 'fwd'|'ret',
  leaveH, dwell,
  surprise, jumpT,
  bubbles, backlog, msgCount, phoneLit, glance, blink,
}
```

Do not derive state from DOM classes. The DOM is a projection.

## 2. Drag that “follows the hand”

On `pointerdown`, measure the widget rect, compute the knob centre from `pos`, and store the pointer's offset **only if it started on the knob**:

```js
const knobX = rect.left + lensMin + pos*(lensMax-lensMin);
grabOff = Math.abs(e.clientX-knobX) < lensR*1.05 ? e.clientX-knobX : 0;
dragStarted = false;
dragTarget = pos;
```

On `pointermove`, don't move until the pointer has travelled ~3px (so a click is a click). Then use the **absolute** target, minus the grab offset:

```js
dragTarget = clamp((e.clientX - grabOff - rect.left - lensMin)/(lensMax-lensMin), 0, 1);
```

On each update, the displayed position follows with exponential smoothing, rate 34/s:

```js
pos += (dragTarget - pos) * (1 - Math.exp(-34*dt));
vel = (pos - prev)/dt;         // for release and stretch
```

Absolute mapping is what “跟手” means. Relative dragging makes the knob lag behind the finger when you grab anywhere but the exact centre.

## 3. Release and the critically damped spring

On pointerup:

```js
const v = clamp(vel, -3, 3);
target = (pos + v*0.09 >= 0.5) ? 1 : 0;
```

A flick near the end carries; a slow release at 0.49 snaps back. Then settle with a critically damped spring:

```js
const w = reduced ? 16 : 9.5;
const acc = w*w*(target - pos) - 2*w*vel;
vel += acc*dt;
pos += vel*dt;
if (Math.abs(target-pos) < 0.0005 && Math.abs(vel) < 0.0035) { pos = target; vel = 0; }
```

Keep dt clamped (≤50ms) so a background tab cannot explode the integration. Use semi-implicit Euler; it is stable at these rates.

Click: if the pointer moved <6px (or never crossed the drag threshold), toggle to the other end. Do not require a short press time; a deliberate 600ms click should still toggle.

## 4. The lens as a spring

Lift:

```js
const pressTarget = dragging ? 1 : 0;
lift += (pressTarget - lift) * (1 - Math.exp(-14*dt));   // exp rate 14
```

Apply: radius × (1 + 0.012·lift), lens centre up 2px, shadow grows. The radius change is small; the shadow and reflection do the visual work.

Stretch is under-damped and follows the **absolute velocity**:

```js
const targetS = clamp(Math.abs(vel)*0.42, 0, 1.2);
const a = 170*(targetS - stretch) - 11*stretchV;
stretchV += a*dt;
stretch += stretchV*dt;
sx = 1 + 0.20*stretch;
sy = 1 - 0.075*stretch;
```

At the ends, kick `stretchV` once when arriving with speed (latch so it doesn't accumulate every frame). The requested numbers are k 170, c 11; with reduced motion, zero the stretch and use the stiffer spring (ω 16) for position.

## 5. Position → clock (two roads)

Forward:

```js
if (mode==='fwd'){
  if (pos >= 0.9995) return 21.5 + 1.9*min(1, dwell/26); // right-end drift
  return 12 + 9.5*pos;
}
```

Return (leaving from the right end with `leaveH`):

```js
return leaveH + (36 - leaveH)*(1 - pos);
```

This equals `mix(36, leaveH, pos)`. At `pos=1` it is the departure hour; at `pos=0` it is 36, i.e. **12:00 the next day** after walking through 24→0→12. Take the displayed hour modulo 24 for visuals:

```js
const h = rawHour();
const h24 = h >= 24 ? h - 24 : h;
```

Switch roads only at the ends:

- `fwd → ret` when the slider starts leaving the right end (pos < ~0.994 after having arrived).
- `ret → fwd` when it reaches the left end (pos ≤ ~0.002).
- At the right end in fwd mode, advance `dwell` toward 26s and capture `leaveH` when leaving. This is what makes “the clock walks 21.5 → 23.4 while parked” and “coming back is another road” both true.

Darkness (page and shell):

```js
night = clamp(1 - smooth(1.5,3.6,h24) + smooth(17.4,20.2,h24), 0, 1);
```

At noon it is 0; after 20.2 it is 1; the dawn fades it out between 1.5 and 3.6. Use the **displayed** hour, not the raw one, or the return road stays dark forever.

## 6. Story phases and announcements

Derive a phase from the position/road for the screen reader:

- left end, forward: 可以打扰
- forward, not at end: 进入专注
- right end: 专注
- returning: 结束专注
- morning part of the return: 休息

Use the *target* for the phase on a click/keyboard action, not the mid-spring position; otherwise clicking “on” announces “可以打扰”.

Update a visually hidden `role="status" aria-live="polite"` only when the text changes. On a drag, announce on release; on keyboard, announce each step.

## 7. ARIA, change events, keyboard

```html
<button role="switch" aria-checked="false" aria-label="专注模式"></button>
```

- `aria-checked` reflects the committed on/off state; update it in one `setOn(v)` helper.
- Dispatch `new CustomEvent('change',{bubbles:true,detail:{on}})` **from the switch** when the boolean changes. Do not dispatch on every 4% key step if the state is unchanged.
- ArrowLeft/Right move 4% of the range; Home/End jump; Space/Enter toggle. Prevent default on Space/Enter so the page doesn't scroll and the native click doesn't double-toggle.
- Screen readers may fire a synthetic `click` with `detail === 0`. Handle it, and ignore it for ~500ms after a keyboard toggle to avoid a double toggle.
- Focus-visible: an outline that follows the capsule, offset 6–8px. Do not remove it.
- Pointer capture in a `try/catch`; synthetic pointers and some browsers throw.
- The DOM button covers the capsule exactly; the canvas is `pointer-events:none`.

## 8. Reduced motion and pausing

`matchMedia('(prefers-reduced-motion: reduce)')`, listen for changes.

When reduced:
- no lens stretch (`sx=sy=1`), no surprise, no particles/steam/dust;
- no automatic message bubbles (or make them instantaneous state changes);
- keep the story transitions when the user moves the control;
- stop the render loop when idle: no drag, near-target, zero velocity, no lift/surprise/bubbles, and not at the right-end drift. Restart on any interaction, resize or visibility change.

Pause when the stage leaves the viewport (IntersectionObserver) or the tab is hidden. On return, resume. Never let a paused tab accumulate a giant `dt`.

## 9. The 2D fallback

Keep it honest and attractive, not a blank canvas:

- clip to the inner capsule; draw the world at an integer scale centered on the core;
- draw a simple shell (rounded stroke/gradient), a top inner shade and a glass sheen;
- draw a translucent round thumb with a highlight and a soft shadow;
- at night, use the same palette/light overlay or a simple radial lamp glow.

When WebGL2 is missing, use 2D. When the shader fails **after** a WebGL context exists, the canvas is locked to WebGL: replace the canvas with a fresh node, then get 2D. When the first successful WebGL frame reads back transparent, do the same. See `references/webgl-optics.md` §10.

## 10. Checklist

- [ ] Drag is absolute and starts only after 3px.
- [ ] Release uses position + clamped velocity.
- [ ] Click and keyboard toggle reliably, with no double `change`.
- [ ] `aria-checked` and the live region reflect the committed state.
- [ ] The lens has lift, stretch, a soft spring and an endpoint kick.
- [ ] No position derived from DOM; no animation derived from `dt` of a hidden tab.
- [ ] Reduced motion removes stretch/scare/particles and stops drawing when idle.
- [ ] 2D fallback is present and usable.
- [ ] Focus ring is visible; the button has a name and a role.
