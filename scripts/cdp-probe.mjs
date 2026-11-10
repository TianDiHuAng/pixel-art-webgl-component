// Drive a running Chrome (started by chrome-cdp.ps1) and capture evidence.
// Requires Node 22+ (built-in fetch + WebSocket). No npm packages.
//
//   node cdp-probe.mjs --port=9555 --out=probe --reload
//   node cdp-probe.mjs --port=9555 --out=night --no-click
//
// Outputs: <out>-before.png, <out>-after.png and a JSON report on stdout.

import fs from 'node:fs';

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return def;
  const a = argv[i];
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  return argv[i + 1] ?? def;
}
const port = Number(arg('port', 9555));
const out = arg('out', 'cdp-probe');
const wait = Number(arg('wait', 1800));
const doReload = argv.includes('--reload');
const noClick = argv.includes('--no-click');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find(t => t.type === 'page' && t.url.includes('.html')) || list.find(t => t.type === 'page');
  if (!page) throw new Error('No page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`EXCEPTION: ${m.params.exceptionDetails?.text ?? ''} ${m.params.exceptionDetails?.exception?.description ?? ''}`);
    } else if (m.method === 'Log.entryAdded') {
      logs.push(`LOG ${m.params.entry.level}: ${m.params.entry.text}`);
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const n = ++id; pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalv = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${out}-${name}.png`;
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  if (doReload) { await send('Page.reload', { ignoreCache: true }); }
  await sleep(wait);

  // Generic selectors: any role=switch + canvas component. The #id fallbacks
  // cover the reference example.
  const info = await evalv(`(() => {
    const b = document.querySelector('[role="switch"]') || document.getElementById('btn');
    const c = document.querySelector('canvas') || document.getElementById('view');
    const live = document.querySelector('[aria-live]') || document.getElementById('live');
    const btnRect = b?.getBoundingClientRect();
    const stage = document.getElementById('stage') || c?.parentElement?.parentElement;
    return {
      title: document.title,
      aria: b?.getAttribute('aria-checked') ?? null,
      live: live?.textContent ?? null,
      stageBg: stage ? getComputedStyle(stage).backgroundColor : null,
      switchRect: btnRect ? {x:btnRect.x,y:btnRect.y,width:btnRect.width,height:btnRect.height} : null,
      canvas: c ? {w:c.width,h:c.height} : null,
      webgl2: c ? !!c.getContext('webgl2') : null,
      dpr: devicePixelRatio
    };
  })()`);

  const files = [];
  files.push(await shot('before'));

  let after = null;
  if (!noClick && info.switchRect) {
    const x = info.switchRect.x + info.switchRect.width / 2;
    const y = info.switchRect.y + info.switchRect.height / 2;
    await click(x, y);
    await sleep(1800);
    after = await evalv(`(() => {
      const b = document.querySelector('[role="switch"]') || document.getElementById('btn');
      const live = document.querySelector('[aria-live]') || document.getElementById('live');
      const c = document.querySelector('canvas') || document.getElementById('view');
      const stage = document.getElementById('stage') || c?.parentElement?.parentElement;
      return { aria: b?.getAttribute('aria-checked') ?? null, live: live?.textContent ?? null,
               stageBg: stage ? getComputedStyle(stage).backgroundColor : null };
    })()`);
    files.push(await shot('after'));
  }

  // keyboard path: focus, nudge right, read the announcement
  const focus = await evalv(`(() => {
    const b = document.querySelector('[role="switch"]') || document.getElementById('btn');
    if (!b) return false; b.focus(); return document.activeElement === b;
  })()`);
  await key('ArrowRight', 'ArrowRight', 39);
  await sleep(650);
  const keys = await evalv(`(() => {
    const b = document.querySelector('[role="switch"]') || document.getElementById('btn');
    const live = document.querySelector('[aria-live]') || document.getElementById('live');
    return { aria: b?.getAttribute('aria-checked') ?? null, live: live?.textContent ?? null };
  })()`);

  console.log(JSON.stringify({ info, after, focus, keys, logs, files }, null, 2));
  ws.close();
}
main().catch(e => { console.error(e); process.exit(1); });
