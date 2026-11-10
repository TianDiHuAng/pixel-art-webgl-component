# WebGL2 optics: shell, window, lens, light

One fragment shader can paint the whole component. The scene is a 2D SDF composition; the only texture is the pixel world. That avoids framebuffer feedback and makes the lens a pure coordinate remap.

## Contents
1. Geometry and the scaling rule
2. Screen coordinates, SDFs, world mapping
3. Fragment order
4. The shell as a rounded bevel
5. The window glass
6. The lens
7. Light field sampling
8. Outside: shadows and leak
9. Anti-aliasing, noise, alpha
10. Shader hygiene and runtime guards
11. Canvas, DPR, and uniforms

## 1. Geometry and the scaling rule

All numbers in CSS pixels. The component is a 16:9 stage at 60% width; you can derive everything from `compH`:

```js
capH = compH / 1.32;
capW = capH * 1.85;
shell = capH * 0.046;
winW = capW - 2*shell;
winH = capH - 2*shell;
lensR = winH/2 - capH*0.032;
lensTravel = winW/2 - lensR;       // centre travel from the window centre
lensX = winCX + (2*x - 1) * lensTravel;
lensY = winCY - 2*lift;
```

The window is a **stadium**: rounded rect with `radius = winH/2`. The lens is a circle just smaller than the window height; it fits because the stadium's straight section is much longer than its half-height.

Choose the world pixel scale from the window height:

```js
let k = Math.max(1, Math.floor(winH / 112));
if ((k+1)*112 - winH <= 0.12*winH) k++;   // crop at most 12% for bigger pixels
```

This can crop the core vertically at some resolutions. It is a deliberate trade: fill the frame and keep pixels big. If the composition must never crop, add a “cover” fallback when the integer scale leaves the 220×140 texture smaller than the window; otherwise accept the crop. Document the choice.

## 2. Screen coordinates, SDFs, world mapping

Convert `gl_FragCoord` (device, bottom-left) to CSS, top-left:

```glsl
vec2 fc = gl_FragCoord.xy / uDpr;
fc.y = uRes.y - fc.y;
```

SDF helper:

```glsl
float sdRoundBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r;
}
float sdStadium(vec2 p, vec2 halfSize){
  return sdRoundBox(p, halfSize, halfSize.y);
}
```

Regions:

```glsl
vec2 pc = fc - uCapC;   float dCap = sdStadium(pc, uCapH);
vec2 pw = fc - uWinC;   float dWin = sdStadium(pw, uWinH);
// dCap > 0 outside; dWin > 0 in the shell; dWin <= 0 in the window.
```

World pixel mapping, centered on a chosen core center `uWorldC`:

```glsl
vec2 room = (fc - uWinC)/uK + uWorldC;
vec3 sampleWorld(vec2 room){
  vec2 ip = floor(room + uMargin);                  // apron offset
  ivec2 t = ivec2(clamp(ip, vec2(0.0), uWorldSize-1.0));
  return texelFetch(uWorld, t, 0).rgb;              // NEAREST, crisp
}
```

`uK` is an integer CSS-px-per-world-px. `uMargin` = the apron size in world px. The window shows `winW/uK × winH/uK` world px; the apron is the outside the lens can see. Clamp at the texture borders; make the border pixels a plausible continuation (wall/floor), not transparent.

## 3. Fragment order

One pass, early branches:

```
if dWin <= 0:   window (world + glass + lens)
else if dCap <= 0: shell
outside path:   shadows + leak
finally:        blend inside/outside via fwidth(dCap), add noise
```

Exact ordering inside the window matters: lens shadow must darken the flat world **before** the lens replaces it; the light field is screened on top of the lens, not underneath it.

## 4. The shell as a rounded bevel

The shell is the ring between the capsule and the window. Treat its cross-section as a quarter profile: flat at the window side, falling to horizontal at the outer silhouette.

```glsl
float t = clamp(-dCap/uShell, 0.0, 1.0);    // 0 outer edge, 1 inner edge
vec2 g = normalize(vec2(dFdx(dCap), dFdy(dCap)) + vec2(1e-6));
float s = 1.0 - t;
float z = sqrt(max(1.0 - s*s, 0.0));
float sl = s / max(z, 0.10);
vec3 N = normalize(vec3(g*sl*0.72, 1.0));
```

- At `t=0` (outer), `N` approaches horizontal outward → maximum Fresnel.
- At `t=1` (inner), `N` is up → flat top surface.
- Use `dFdx/dFdy` of the capsule SDF so the normal follows the rounded ends.

Studio reflection (fake but convincing):

```glsl
vec3 V = vec3(0,0,1);
vec3 R = reflect(-V, N);
float box  = smoothstep(0.30, 0.94, dot(normalize(R+vec3(0,0,0.18)), normalize(vec3(-0.45,0.82,0.38))));
float fill = smoothstep(0.60, 1.00, dot(normalize(R+vec3(0,0,0.20)), vec3(0.05,-0.95,0.30)));
float F = 0.035 + 0.965*pow(1.0 - clamp(N.z,0.0,1.0), 5.0);
col = base*(0.80 + 0.20*N.z);
col += vec3(1.0,0.985,0.945)*(box*0.52 + fill*0.05)*(0.35 + 0.65*F);
col += vec3(1.0,0.96,0.86)*F*0.10;
```

Base color:

```glsl
vec3 base = mix(uShellDay, uShellFocus, smoothstep(0.22,0.92,uFocus));
base *= mix(1.0, 0.44, uNight);                       // night dims the shell
base *= mix(0.70, 1.0, smoothstep(0.0,0.10,t));       // outer AO
base *= mix(1.0, 0.58, smoothstep(0.76,1.0,t));        // window-side recess
base = mix(base, base*1.10 + uWarm*0.16, clamp(warm*0.9,0.0,1.0));
```

where `warm = exp(-dist(fc, lampScreenPos)/(winH*0.85)) * uLampI`.

Avoid a bright outline at the window boundary; a dark seam (`mix(0.55,1.0,smoothstep(0.0,2.2,dWin))`) gives the recess. The window side is darker by design.

## 5. The window glass

```glsl
vec3 c = sampleWorld(room);
// top inner shadow (use window-local normalized y)
float ty = (pw.y + uWinH.y)/(2.0*uWinH.y);
c *= mix(0.60, 1.0, smoothstep(0.0, 0.12, ty));
// dark rim all around
float din = -dWin;
c *= mix(0.50, 1.0, smoothstep(0.0, 4.5, din));
// broad faint diagonal sheen
float du = (pw.x/uWinH.x)*0.62 + (pw.y/uWinH.y)*0.38;
float sheen = 1.0 - smoothstep(0.02, 0.40, abs(du-0.10));
c += vec3(0.045,0.045,0.04)*sheen;
```

The window is not glass in the reflection sense; it is a recessed display. Keep the sheen very faint and large, and do not add a bright 1px border.

## 6. The lens

Local normalized coordinates:

```glsl
vec2 q = (fc - uLens) / vec2(uLensR*uLensS.x, uLensR*uLensS.y);
float d = length(q);
```

### Warp
Flat center magnifies 1.24× (sample closer to the centre). The outer 30% bends rapidly and pulls the surrounding scene into the rim:

```glsl
float f = mix(1.0/1.24, 1.72, smoothstep(0.70, 1.0, d));
float disp = smoothstep(0.55, 1.0, d) * 0.05;   // ~5% chromatic dispersion
vec2 off = fc - uLens;
vec2 lensWorld = (uLens - uWinC)/uK + uWorldC;
vec3 rc;
rc.r = sampleWorld(lensWorld + off*(f*(1.0+disp))/uK).r;
rc.g = sampleWorld(lensWorld + off*(f        )/uK).g;
rc.b = sampleWorld(lensWorld + off*(f*(1.0-disp))/uK).b;
```

At `d=0.7`, the flat scale is `1/1.24`; at `d=1`, the sample is 1.72× farther out, so the surroundings are compressed into the ring. The rim is where the liquid-glass look is won. A smoothstep that starts earlier (0.62) makes a softer, less convincing bubble; 0.68–0.72 is the sweet spot.

### Lens surface
- thickness: `rc *= mix(1.0, 0.34, smoothstep(0.86,1.0,d)); rc *= 1.0-0.055*smoothstep(0.5,0.86,d);`
- no bright rim. The edge reads by darkening.
- lower inner caustic: a ring masked to the lower half, warm:
  ```glsl
  vec2 nq = q/max(d,1e-4);
  float lower = smoothstep(-0.30,0.90,nq.y);
  float ring = smoothstep(0.70,0.92,d)*(1.0-smoothstep(0.955,1.0,d));
  rc += vec3(1.0,0.86,0.64)*ring*lower*0.30;
  ```
- soft top reflection: 1–2 blurred ellipses, not a hard white dot.
- very edge: `rc *= 1.0 - 0.45*smoothstep(0.93,1.0,d);`

### Shadow cast on the world
Before compositing the lens:

```glsl
vec2 shC = uLens + vec2(2.0, 7.0 + 9.0*uPress);
vec2 shq = (fc - shC) / (vec2(uLensR*uLensS.x*1.03, uLensR*uLensS.y*1.06) * (1.0+0.09*uPress));
float sh = (1.0 - smoothstep(0.52,1.06,length(shq))) * (0.30+0.14*uPress);
c *= 1.0 - sh;
```

The offset and spread grow with press; that is what sells the lift.

### Press and stretch
The JS passes `uLensS = vec2(1+0.2s, 1-0.075s) * (1+0.012*press)`. Clamp the lens centre so the stretched circle stays inside the window at the ends; never let it clip on the shell.

## 7. Light field sampling

The grid is 72×1 RGBA8. Use a cubic B-spline (not linear) to avoid a banding/segment look:

```glsl
float x = clamp((room.x + uMargin)/uWorldSize.x, 0.0, 1.0)*uLightN - 0.5;
float i = floor(x), f = x - i;
float w0=(1.0-f)*(1.0-f)*(1.0-f)/6.0;
float w1=(3.0*f*f*f - 6.0*f*f + 4.0)/6.0;
float w2=(-3.0*f*f*f + 3.0*f*f + 3.0*f + 1.0)/6.0;
float w3=f*f*f/6.0;
vec4 acc = texelFetch(uLight, ivec2(clamp(int(i)-1,0,int(uLightN)-1),0), 0)*w0
         + texelFetch(uLight, ivec2(clamp(int(i)  ,0,int(uLightN)-1),0), 0)*w1
         + texelFetch(uLight, ivec2(clamp(int(i)+1,0,int(uLightN)-1),0), 0)*w2
         + texelFetch(uLight, ivec2(clamp(int(i)+2,0,int(uLightN)-1),0), 0)*w3;
```

Screen-blend after the lens:

```glsl
vec3 li = acc.rgb;
c = 1.0 - (1.0-c)*(1.0 - clamp(li*0.85, 0.0, 1.0));
```

The lens and the window get the same field; the field is a light *in the room*, not an overlay on the glass.

## 8. Outside: shadows and leak

Offset capsule SDFs downward for a soft, two-layer shadow; use exponential falloff rather than a hard ellipse:

```glsl
float ds1 = sdStadium(fc - uCapC - vec2(0,9),  uCapH);
float ds2 = sdStadium(fc - uCapC - vec2(0,20), uCapH + vec2(7,0));
float aSh = clamp(exp(-max(ds1,0.0)/16.0)*0.22 + exp(-max(ds2,0.0)/52.0)*0.11, 0.0, 0.42);
```

Leak:

```glsl
float d = max(dCap,0.0);
float side = 0.35 + 0.65*smoothstep(0.0,1.0,(fc.x-uCapC.x)/uCapH.x);
vec3 leakC = uWarm * (exp(-d/58.0)*uLampI*0.62*side);
```

Output straight alpha with `premultipliedAlpha:false`: `vec4((shadowColor*aSh + leakC)/max(aOut,1e-4), aOut)`. The page background shows through transparent pixels; the shadow color must be physically dark, not the stage color.

## 9. Anti-aliasing, noise, alpha

The capsule edge is a curve; a hard SDF branch jaggies. Compute a 1px blend:

```glsl
float aa = max(fwidth(dCap), 0.70);
float inW = clamp(0.5 - dCap/aa, 0.0, 1.0);
vec3 finalCol = mix(outCol, col, inW);
float finalA = clamp(inW + (1.0-inW)*aOut, 0.0, 1.0);
finalCol += (hash21(floor(fc))-0.5)*(1.5/255.0);
```

The noise is **±0.75/255**, static (do not animate), and applied before output. Use a stable hash of the fragment, not time.

## 10. Shader hygiene and runtime guards

- `#version 300 es` must be the first line; `precision highp float;`; declare `out vec4 outColor`.
- **Never call `smoothstep(hi, lo, x)`** with reversed edges. Drivers vary; write `1.0 - smoothstep(lo, hi, x)`. This bit us on real GPU testing.
- Derivatives (`dFdx/dFdy`, `fwidth`) are core in ES 3.00 but can be flaky on very old mobile GPUs; a 2D fallback covers them.
- A shader compile failure after `getContext('webgl2')` locks the canvas. Probe on a 4×4 throwaway canvas first; if the real shader fails, replace the canvas with a fresh one before 2D.
- A successful draw can still be blank. After the first frame, `readPixels` one pixel inside the capsule; if alpha < 8, swap to 2D. This saved a blank-screen report.
- `texelFetch` needs `NEAREST`; it ignores filtering. Set `CLAMP_TO_EDGE` and make the apron border plausible.
- Uniform arrays: pass `Float32Array` to `uniform3fv`; plain arrays usually work, but the typed version is unambiguous.
- Do not use `gl.getExtension('WEBGL_lose_context')` on the probe and immediately create another context on some drivers; leave the probe to GC or lose it only after the real context is alive.

## 11. Canvas, DPR, and uniforms

```js
canvas.width  = Math.round(cssW * dpr);
canvas.height = Math.round(cssH * dpr);
canvas.style.width = cssW + 'px';  // CSS layout controls it
canvas.style.height = cssH + 'px';
```

Use the **real devicePixelRatio** (cap only at 3 for sanity). Capping at 2 on a 2.5× display upsamples the canvas and blurs the painting. Add `image-rendering: pixelated`; with a fractional CSS size (e.g. 857.59px) the canvas is resampled by a fraction and would otherwise soften.

Set the viewport to the buffer size. Geometry uniforms are CSS px; convert the fragment coords by `uDpr`. Recompute geometry on resize and on `ResizeObserver`; the world texture does not change with size.

Uniform set that proved sufficient: resolution/dpr, capsule centre/half, shell, window centre/half, lens centre/scale/radius/press, k, world centre/size/margin, night, focus, lamp position/intensity, time, world texture, light texture, light count, shell day/focus, warm color.

Upload the world texture only when it changes (30fps); upload the light texture on the same cadence. Keep the shader drawing at display rate.
