# Verification and diagnosis

Visual work needs an evidence loop. The browser is the judge; the screenshot is the transcript. This file covers the delivery gate, a headless/CDP harness, how to “see” pixel art without eyes, and the blank-page decision tree that saves you from rewriting working code.

## Contents
1. Static delivery gate
2. Headless Chrome screenshots
3. Driving real input with CDP
4. Seeing the pixel world as ASCII
5. Blank / beige decision tree
6. The Windows Internet Explorer trap
7. High-DPI blur and canvas sizing
8. WebGL failure, canvas lock, and blank success
9. Shader portability
10. What to verify before saying “done”

## 1. Static delivery gate

Before any screenshot:

- Extract the inline `<script>` and parse it, don't just eyeball it:
  ```powershell
  $html = Get-Content -Raw .\page.html
  $m = [regex]::Match($html, '(?s)<script>(.*)</script>')
  Set-Content -NoNewline _check.js $m.Groups[1].Value
  node --check _check.js
  ```
- Assert **no external references**: `http://`, `https://`, `src=`, `url(http`, external `<link>`.
- Assert **no debug hooks**: `URLSearchParams`, `?x=`, `__focusSwitch`, `?world`, `?test`, `dump=`.
- One delivered file; delete `_src`, build scripts, screenshots, profiles.
- Check the button: `role="switch"`, `aria-checked`, an accessible name, `change` dispatch.
- `scripts/verify-html.mjs` automates the above.

## 2. Headless Chrome screenshots

Use Chrome directly, a **unique user-data-dir**, and `Start-Process` + `WaitForExit` so a hung instance cannot block the session:

```powershell
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$prof   = Join-Path $env:TEMP ('shot-' + [guid]::NewGuid())
$out    = Join-Path $PWD 'shot.png'
$p = Start-Process -FilePath $chrome -PassThru -ArgumentList @(
  '--headless=new','--hide-scrollbars',
  '--enable-unsafe-swiftshader','--use-angle=swiftshader',
  "--user-data-dir=$prof",'--no-first-run',
  '--window-size=1600,900',
  "--screenshot=$out",
  "file:///$($PWD.Path -replace '\\','/')/page.html"
)
$p.WaitForExit(20000) | Out-Null
if (-not $p.HasExited) { Stop-Process $p.Id -Force }
```

Flags that matter:

| Goal | Flags |
|---|---|
| WebGL2 reliably in CI/VM | `--enable-unsafe-swiftshader --use-angle=swiftshader` |
| Real GPU path | omit those; add `--disable-gpu-sandbox` only if needed |
| Force the 2D fallback | `--disable-3d-apis` |
| Reduced motion | `--force-prefers-reduced-motion` |
| Exact stage aspect | `--hide-scrollbars --window-size=1600,900` |
| Let timers/rAF run | `--virtual-time-budget=1500` |

Gotchas learned the hard way:

- **Do not run multiple headless Chrome instances at once** with the same/default profile; a second run can hang without writing the shot. Use unique profiles and kill leftovers before launching.
- The screenshot is sometimes written **before** Chrome exits. If the process hangs, use the file and kill it; don't conclude failure.
- `--virtual-time-budget` advances timers, but `requestAnimationFrame` may only run a handful of frames in headless screenshot mode. A spring animation can be captured **mid-flight**; for final states set the slider via a debug hook or drive real time with CDP. Do not use a virtual-time screenshot to judge “it never reaches the end”.
- `--dump-dom` does not force compositor frames; a rAF-driven canvas may be blank/mid-frame. Screenshot or CDP for rendering, DOM dump only for logic/attributes.
- The CDP viewport may be smaller than `--window-size` because of OS display scaling; read `getBoundingClientRect()` instead of hard-coding stage coordinates.

Shoot a matrix: 1280×720, 1600×900, 1920×1080; left end, right end, and a mid-hold. Add reduced-motion and `--disable-3d-apis` runs. Inspect the crop, the shell edge, the lens at both ends, the night warmth and the text-free screen.

## 3. Driving real input with CDP

Node 22+ has built-in `fetch` and `WebSocket`, so no packages are needed.

1. Launch Chrome with `--remote-debugging-port=9555 --headless=new --user-data-dir=<unique>` and the file URL.
2. `GET http://127.0.0.1:9555/json/list`, take the page's `webSocketDebuggerUrl`.
3. Connect; enable `Page`, `Runtime`, `Log`.
4. `Page.reload`, wait ~2s, collect `Runtime.consoleAPICalled` / `exceptionThrown` / `Log.entryAdded`.
5. `Runtime.evaluate` to read `aria-checked`, the live region, `getComputedStyle(stage).backgroundColor`, the widget rect.
6. `Input.dispatchMouseEvent` (mousePressed/mouseMoved/mouseReleased) for drags and clicks; `Input.dispatchKeyEvent` after focusing the button.
7. `Page.captureScreenshot` to a file; `Emulation.setEmulatedMedia` for reduced motion.

The bundled `scripts/cdp-probe.mjs` does this. It is the only reliable way to test springs, click-vs-drag thresholds, `change` counts, and the keyboard announcements.

## 4. Seeing the pixel world as ASCII

A 9px head can be invisible to an image-description model. Sample the screenshot yourself. Put the world at a known integer zoom (a debug mode helps), then map each block to the nearest palette color and print a character:

```python
from PIL import Image
from collections import Counter
im = Image.open('shot.png').convert('RGB')
# map hex -> (r,g,b); chars per family/level, e.g. W wall, S surface, f fg, M muted, a accent
# X0,Y0 = top-left of the world image; SCALE = integer zoom; CORE offsets
for cy in range(0,112,2):
    line=''
    for cx in range(0,192,2):
        cs=Counter()
        for dy in range(2):
            for dx in range(2):
                p=im.getpixel((X0+(cx+dx+MARGIN)*SCALE+2, Y0+(cy+dy+MARGIN)*SCALE+2))
                cs[nearest(p)]+=1
        line+=chars[cs.most_common(1)[0][0]]
    print(line)
```

This immediately shows whether the monitor is lit, the window is open, the bookshelf has books, and whether the “chair” is actually a person. Use it on the raw world, not through a lens.

## 5. Blank / beige decision tree

Work **outside-in**. Do not touch the shader until steps 1–3 are clear.

1. **What exactly is visible?**
   - Body grey `#e9e9e9` only → the stage/layout has no height, CSS failed, or the page didn't load.
   - Cream stage, no capsule → CSS is fine; the canvas is blank, zero-sized, or the scripts aren't running.
2. **Where is it open?**
   - Chat/file preview/card? Many previews run HTML in a sandbox with scripts disabled. A cream stage is the expected result; the file is fine. Open it in a browser.
   - OS default handler? On Windows, check:
     ```powershell
     cmd /c assoc .html
     cmd /c ftype htmlfile
     Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\FileExts\.html\UserChoice' -ErrorAction SilentlyContinue
     ```
     If it maps to `iexplore.exe`, the page is dead on arrival. This happened: a perfectly working component showed “only beige” because `.html` opened in Internet Explorer.
3. **In Chrome/Edge, still blank?** Open DevTools Console; look for a syntax error (old browser), a null element, a thrown WebGL call.
4. **Canvas size**: `getBoundingClientRect()` of the canvas. If 0×0, check `aspect-ratio`, `min()`/`100vh` in embeds, and set explicit heights as a fallback.
5. **WebGL2 available?** `getContext('webgl2')`. If null, the 2D path must render; if not, `getContext('2d')` may be locked by a failed WebGL context (see §8).
6. **Shader compile/link**: log `getShaderInfoLog`/`getProgramInfoLog`. Compare against a probe on a throwaway canvas.
7. **Draw succeeds but nothing**: read a pixel at the capsule centre; alpha 0 means the compositor produced nothing.
8. **It draws but is cropped/blurry/mis-coloured**: jump to §6–§7.

If the artifact only fails in a preview, **do not rewrite the component around the preview**. Deliver it, and tell the user to open it in Chrome/Edge. A blank sandbox is not a code bug.

## 6. The Windows Internet Explorer trap

`assoc .html` can return `htmlfile`, and `HKCR\htmlfile\shell\open\command` can point at `iexplore.exe`. IE11 cannot parse `const`, arrow functions, template literals or `String.padStart`, and has no WebGL2; the stage CSS may still paint the cream, so the user sees “the whole page is beige”. This is not a rendering bug.

Actions:

- Open the file explicitly in Chrome/Edge:
  ```powershell
  Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' 'file:///D:/path/page.html'
  ```
- Tell the user; suggest right-click → Open with → Chrome, or setting Chrome as the default browser.
- Only consider an ES5 rewrite if the target environment is *known* to be legacy; WebGL2 would still be unavailable, so the 2D fallback would have to carry the whole experience.

## 7. High-DPI blur and canvas sizing

Symptom: the page shows, but looks soft/doubled; pixel edges aren't crisp.

- The canvas drawing buffer must be `round(cssSize × devicePixelRatio)`. Do **not** cap DPR at 2 on a 2.5×/3× display; the browser upscales the canvas.
- The CSS size is often fractional (`60%` of a fractional stage). The browser resamples 858→857.59; add `image-rendering: pixelated` so nearest-neighbour wins instead of a soft bilinear.
- Use `NEAREST` + `texelFetch` for the world. Do not let a linear filter touch the pixel texture.
- Integer `k` is in CSS px; with DPR 1.25 the device pixel size is fractional (3.75). Even with nearest sampling the pixel *grid* is uneven, but the edges stay crisp; that's acceptable. If strict uniformity is required, compute `k` in device px instead.

## 8. WebGL failure, canvas lock, and blank success

A canvas can only have one context type. If you create `webgl2` and the shader fails, `getContext('2d')` returns `null` forever. Three guards:

1. **Probe first.** Create a 4×4 throwaway canvas, get WebGL2, compile/link the real shaders. If it fails, return false **without touching the visible canvas**; 2D can attach.
2. **Swap on late failure.** If the real context was created and compile/link still fails, clone the canvas node, replace the old one, and call `getContext('2d')` on the fresh node. Keep a mutable `let view` for this.
3. **Check the first frame.** After `drawArrays`, `readPixels` one pixel at the capsule centre on the backbuffer. `alpha < 8` (or all-zero color) means the driver returned a “successful” blank; set a force-2D flag, swap the canvas, render the 2D fallback. Once only.

Also:

- Handle `webglcontextlost`: swap to 2D instead of reloading the page.
- Wrap the first `render()` in a try/catch; a thrown uniform/extension call otherwise leaves a blank stage.
- Use `premultipliedAlpha:false` and straight alpha so the page background and shadows composite correctly; don't mix straight and premultiplied.
- The one-time `readPixels` guard can produce a “GPU stall due to ReadPixels” performance warning in Chromium. That is expected; it is not a failure.

## 9. Shader portability

- `smoothstep` with `edge0 > edge1` is **undefined**. Write `1.0 - smoothstep(edge0, edge1, x)`. SwiftShader may accept it while a real GPU shows garbage.
- Keep `#version 300 es` as the literal first line, `precision highp float`, and an explicit output.
- `texelFetch` requires `NEAREST` and integer coords. Clamp them.
- Pass `Float32Array` to `uniform3fv`; plain arrays usually work but are not worth the ambiguity.
- Avoid relying on `dFdx` for correctness on ancient mobile GPUs; the 2D fallback is the escape hatch.
- Test both the default GPU path and SwiftShader. They can differ in compile strictness and precision.

## 10. What to verify before saying “done”

- Static gate passes: syntax, self-contained, no debug hooks, one file.
- Headless screenshots at 3 viewport sizes, day/night, both ends, mid-hold.
- Reduced-motion screenshot; no-WebGL (2D) screenshot.
- CDP: click toggles; drag moves; release snaps; arrow keys move 4%; `aria-checked` flips; `change` fires once; live region text is correct; stage background follows night.
- At least one run with the **default .html handler** in mind: open explicitly in Chrome. A cream-only page in a preview or IE is not evidence against the page.
- No console errors on a clean load.
- The art reads in a still: person as person, screen lit, window/outdoors legible, shelf with books, lamp glow.
- Delete scratch, profiles and screenshots; keep the single HTML.
