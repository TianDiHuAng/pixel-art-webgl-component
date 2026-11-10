# Palette, time columns, and dithering

A 20-color palette is not a limitation to apologise for; it is what makes the scene read as one object. Generate it once in OKLab, keep it gameable (time + lighting), and never blend between palette entries. Intermediate colors come from the *viewer's* eye mixing adjacent pixels.

## Contents
1. sRGB ↔ OKLab
2. Five bases, four lightness steps, gamut by chroma
3. Four time columns
4. Three lighting variants
5. Material codes and day-locking
6. Key times and 4×4 Bayer replacement
7. The stage background
8. Pitfalls

## 1. sRGB ↔ OKLab

Use linear-sRGB for the conversion, not gamma-encoded bytes. The constants below are the standard Björn Ottosson matrices.

```js
const s2l = c => { c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const l2s = c => {
  c = Math.max(0, Math.min(1, c));
  return 255*(c<=0.0031308 ? 12.92*c : 1.055*Math.pow(c,1/2.4)-0.055);
};
function rgbToOklab(r,g,b){                 // linear rgb
  const l=0.4122214708*r+0.5363325363*g+0.0514459929*b;
  const m=0.2119034982*r+0.6806995451*g+0.1073969566*b;
  const s=0.0883024619*r+0.2817188376*g+0.6299787005*b;
  const L=Math.cbrt(l), M=Math.cbrt(m), S=Math.cbrt(s);
  return [0.2104542553*L+0.7936177850*M-0.0040720468*S,
          1.9779984951*L-2.4285922050*M+0.4505937099*S,
          0.0259040371*L+0.7827717662*M-0.8086757660*S];
}
function oklabToLin(L,a,b){
  const l_=L+0.3963377774*a+0.2158037573*b;
  const m_=L-0.1055613458*a-0.0638541728*b;
  const s_=L-0.0894841775*a-1.2914855480*b;
  const l=l_**3, m=m_**3, s=s_**3;
  return [ 4.0767416621*l-3.3077115913*m+0.2309699292*s,
          -1.2684380046*l+2.6097574011*m-0.3413193965*s,
          -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}
```

## 2. Five bases, four lightness steps, gamut by chroma

The five hues (cream, olive, navy, blue-grey, amber) are chosen so the room can be built from **light/dark values of the same five families**. Keep a fixed base hex and take the hue/chroma from it; only change `L`.

| Base | Hex | Lightness steps |
|---|---|---|
| bg (cream) | `#f5ecd9` | .76 .85 .93 .985 |
| surface (olive) | `#8c9a62` | .40 .52 .64 .76 |
| fg (navy) | `#1b2146` | .17 .25 .33 .44 |
| muted (blue-grey) | `#7f97b3` | .50 .62 .74 .86 |
| accent (amber) | `#efa02c` | .50 .66 .80 .92 |

For each `(base, targetL)`, keep `a,b`, and **reduce chroma until it is in gamut**. Do not clamp RGB (that changes hue and flattens); binary-search a chroma scale. A 20–24 iteration search is plenty and runs once.

```js
const inGamut = rgb => rgb.every(v => v>=-0.0007 && v<=1.0007);
function gamutLab(L,a,b){
  L = Math.max(0, Math.min(0.995, L));
  const at = s => oklabToLin(L, a*s, b*s);
  if (inGamut(at(1))) return at(1);
  let lo=0, hi=1;
  for (let i=0;i<22;i++){ const m=(lo+hi)/2; if (inGamut(at(m))) lo=m; else hi=m; }
  return at(lo);
}
```

Store the 20 results as sRGB bytes plus the Lab. Index order `base*4 + level` keeps the family/level derivable (`base = i>>2`, `level = i&3`), which the lighting variants need.

## 3. Four time columns

Each palette entry has a day/dusk/evening/night color. Transform in Lab, not RGB; this keeps the hue relationships and lets you push warmth/coolness without desaturating everything.

```js
function timeLab([L,a,b], col){
  if (col===0) return [L,a,b];                                  // day
  if (col===1) return [L*0.935+0.018, a*1.14+0.004, b*1.10+0.012]; // dusk, warm
  if (col===2) return [L*0.700+0.016, a*0.90-0.002, b*0.72-0.008]; // evening, cool
  return             [L*0.480+0.020, a*0.64-0.006, b*0.52-0.030]; // night, blue
}
```

These factors were tuned so a near-white cream becomes a readable blue-grey at night while the navy stays nearly black. If you re-theme, keep the *relative* darkening and retune around it; do not simply multiply sRGB.

## 4. Three lighting variants

For every `(column, entry)` compute four variants:

- **normal** — the time color.
- **shadow** — `L-0.068`, chroma ×0.92.
- **lamp** — rotate the chroma toward the accent's hue, keep some of the material's own chroma, and lift lightness toward the *day* lightness so a night surface still glows warm:
  ```js
  const C = Math.hypot(a,b), Ca = Math.hypot(accA, accB) || 1;
  const aa = accA/Ca*C, bb = accB/Ca*C;
  [ clamp(lerp(L, dayL, 0.55)*1.03 + 0.015, 0.1, 0.94),
    lerp(a, aa*1.05 + 0.006, 0.72),
    lerp(b, bb*1.05 + 0.010, 0.72) ]
  ```
  A pure accent replacement makes every lit object the same orange; mixing at 0.72 keeps material identity while reading "lamplight".
- **daylight** — `L+0.060`, chroma ×1.03. Used for sun patches and for a wall that is a brighter version of its own tone, not amber.

Lamp-lighted pixels deliberately use the **day column** (time column 0) when they are emissive or directly under the bulb, so the lamp still glows at midnight. Everything else follows the time column.

## 5. Material codes and day-locking

Pack each pixel into one byte:

```
bit 7      day-locked (outside scenery, screen, phone, lamp bulb)
bits 6..5  variant 0 normal · 1 shadow · 2 lamp · 3 daylight
bits 4..0  material/color index 0..31
```

`day-locked` is not a lighting variant; it means "resolve with time column 0", so the sky and UI stay bright while the room darkens. Draw outside scenery and screens with this bit; draw the window frame, blinds and furniture without it.

Build a resolution table `LUT[col][variant][index]` as `Uint32Array` ABGR. Per frame, pick two adjacent columns and a per-pixel Bayer choice, then index the table once per pixel. Avoid per-pixel object lookups or string colors.

## 6. Key times and 4×4 Bayer replacement

Time is a continuous column position 0..3; key moments pin it:

```js
const KEY = [
  [0,3],[1.5,3],[2.0,3],   // night
  [2.5,2],                 // evening
  [3.0,1],                 // dusk
  [3.6,0],[10,0],[15,0],   // day
  [17,1],[18,1],           // dusk
  [19,2],                  // evening
  [20.3,3],[24,3]          // night
];
```

`timeColumn(h)` interpolates the *column number* linearly between neighbouring keys. Do not interpolate the color. At resolution time:

```js
const tc = timeColumn(hour), c0 = Math.floor(tc), c1 = Math.min(3,c0+1);
const frac = tc - c0;
const bayer = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5].map(v=>(v+0.5)/16);
// per pixel:
tab = (code & DAY) ? LUT[0] : (frac > bayer[(y&3)*4 + (x&3)] ? LUT[c1] : LUT[c0]);
color = tab[variant][code & 31];
```

This is a per-pixel *replacement*, so at a distance the eye mixes; up close it looks printed, which is the point. The 0.5 offset centers the thresholds and avoids a visible bias.

**Outside the room must stay daytime.** Use day-locked colors for the sky, mountains, grass, house, clouds, birds; the window frame, sash, blinds and sill are interior materials and darken.

## 7. The stage background

The page behind the component follows the same clock. Compute the OKLab mix in JS from `#f5ecd9` to the palette's darkest navy and set the stage's inline background; keep the CSS `color-mix(in oklab, …)` as a progressive enhancement. This guarantees the page darkens even where `color-mix()` or CSS variables in `calc()` are unsupported.

```js
const A = rgbToOklab(...hexToLin('#f5ecd9'));
const B = rgbToOklab(...hexToLin(deepestNavy));
const lin = oklabToLin(lerp(A[0],B[0],n), lerp(A[1],B[1],n), lerp(A[2],B[2],n));
stage.style.backgroundColor = `rgb(${lin.map(l2s).map(v=>Math.round(Math.max(0,Math.min(255,v))))})`;
```

Also expose `--night` on the stage for any CSS that wants it; set it once per frame, not per element.

## 8. Pitfalls

- **Chroma clamping in RGB** kills the palette's character; always reduce chroma in Lab.
- **Blending between time columns** produces mud; Bayer replacement gives the same perceived transition without leaving the 20-color set.
- **Forgetting day-lock** on the screen/lamp/sky makes night look dead and breaks the "screen is the light source" story.
- **Changing level but not hue** for night makes everything a muddy grey; push `b` negative and `a` down.
- **Emissive pixels dimming with time** is the most common night-scene bug. If the monitor looks like a grey rectangle at midnight, this is why.
- **A 20-color palette** needs 4×4 Bayer at pixel resolution; do not pre-blur the palette texture.
