// Static delivery gate for a single-file HTML component.
// Usage: node verify-html.mjs path/to/artifact.html
// Exit code 0 = pass, 1 = fail. Warnings do not fail.
//
// Checks: doctype/charset, inline script syntax (compiled, not run),
// self-containment, debug leftovers, and the switch/ARIA contract.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: node verify-html.mjs <file.html>'); process.exit(2); }

const src = fs.readFileSync(file, 'utf8');
const fails = [], warns = [];
const pass = name => console.log(`PASS  ${name}`);
const fail = (name, detail) => { fails.push({name, detail}); console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); };
const warn = (name, detail) => { warns.push({name, detail}); console.log(`WARN  ${name}${detail ? ' — ' + detail : ''}`); };

console.log(`\n${path.basename(file)}  ${(src.length/1024).toFixed(1)} KB  ${src.split(/\r?\n/).length} lines\n`);

if (/^\s*<!doctype html>/i.test(src)) pass('doctype html'); else fail('doctype html');
if (/<meta[^>]+charset=["']?utf-8/i.test(src)) pass('meta charset utf-8'); else fail('meta charset utf-8');
if (/<title>[^<]+<\/title>/i.test(src)) pass('document title'); else warn('document title', 'missing');

// ---- inline scripts -------------------------------------------------------
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, count = 0;
while ((m = scriptRe.exec(src))) {
  count++;
  const attrs = m[1];
  const code = m[2];
  if (/\bsrc\s*=/i.test(attrs)) { fail(`script #${count} external`, attrs.trim()); continue; }
  if (!code.trim()) { warn(`script #${count} empty`); continue; }
  try {
    new vm.Script(code, { filename: `inline-${count}.js` });
    pass(`script #${count} parses (${(code.length/1024).toFixed(1)} KB)`);
  } catch (e) {
    fail(`script #${count} syntax`, e.message);
  }
}
if (!count) fail('inline script present');

// ---- self containment ------------------------------------------------------
const external = [];
for (const re of [/https?:\/\//gi, /\bsrc\s*=\s*["'][^"']+/gi, /<link\b[^>]*href\s*=/gi, /@import\b/gi]) {
  let x;
  while ((x = re.exec(src))) external.push(x[0].slice(0, 80));
}
if (external.length) fail('no external references', `${external.length} hit(s): ${[...new Set(external)].slice(0,4).join(' | ')}`);
else pass('no external references');
if (/\burl\s*\(/i.test(src)) warn('url() present', 'confirm it is a data URI / SVG fragment, not a fetch');

// ---- debug leftovers -------------------------------------------------------
const debugPatterns = [
  ['URLSearchParams', /\bURLSearchParams\b/],
  ['__focusSwitch', /__focusSwitch/],
  ['debug query', /[?&](?:x|world|test|still|dump|auto)=/],
  ['dump title', /\bdocument\.title\s*=\s*JSON/],
  ['test harness', /\bQ\.has\(['"](?:test|world|dump)/]
];
let debugHits = 0;
for (const [name, re] of debugPatterns) if (re.test(src)) { debugHits++; warn(`debug leftover: ${name}`, 'remove before delivery'); }
if (!debugHits) pass('no debug leftovers');

// ---- control contract ------------------------------------------------------
if (/role\s*=\s*["']switch["']/i.test(src)) pass('role="switch"'); else fail('role="switch"');
if (/aria-checked/i.test(src)) pass('aria-checked'); else fail('aria-checked');
if (/<button\b/i.test(src)) pass('native button'); else fail('native button');
if (/CustomEvent\(\s*["']change["']/.test(src) || /dispatchEvent\([^)]*change/i.test(src)) pass('change event'); else warn('change event', 'not found');
if (/prefers-reduced-motion/i.test(src)) pass('reduced motion handling'); else warn('reduced motion handling', 'not found');
if (/getContext\(["']webgl2["']/.test(src)) pass('webgl2 path'); else warn('webgl2 path', 'not found');
if (/getContext\(["']2d["']/.test(src)) pass('2D fallback path'); else warn('2D fallback path', 'not found');
if (/IntersectionObserver/.test(src) || /visibilitychange/.test(src)) pass('pause hooks'); else warn('pause hooks');

// ---- size sanity -----------------------------------------------------------
if (src.length > 5 * 1024 * 1024) fail('file under 5 MB'); else pass('file under 5 MB');

console.log('');
if (fails.length) {
  console.log(`${fails.length} failure(s), ${warns.length} warning(s).`);
  process.exit(1);
}
console.log(`OK — ${warns.length} warning(s).`);
