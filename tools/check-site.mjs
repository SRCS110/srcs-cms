#!/usr/bin/env node
// Checks a client site's editable markup before it goes live.
// Usage: node tools/check-site.mjs <site-folder> [--site <key>]
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';

const args = process.argv.slice(2);
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const siteKey = args.includes('--site') ? args[args.indexOf('--site') + 1] : null;
const TYPES = new Set(['text', 'rich', 'link', 'image', 'list']);
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'col', 'embed', 'wbr', 'track', 'param', 'base']);
const KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

const errors = [];
const warnings = [];
const globals = new Map(); // key -> Set(types)
let regionCount = 0;
let pages = 0;

const attr = (n, name) => n.attrs?.find((a) => a.name === name)?.value;
const typeOf = (n) => { const t = attr(n, 'data-cms-type'); return t || (n.tagName === 'img' ? 'image' : 'text'); };

function files(d) {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', '.vercel', 'tools'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function checkRegion(n, rel, where) {
  const t = typeOf(n);
  const loc = n.sourceCodeLocation;
  const at = `${rel}:${loc?.startLine ?? '?'} ${where}`;
  if (!TYPES.has(t)) errors.push(`${at}: unknown data-cms-type "${t}"`);
  if (t === 'image' && n.tagName !== 'img') errors.push(`${at}: image areas must be <img>`);
  if (t === 'link' && n.tagName !== 'a') errors.push(`${at}: link areas must be <a>`);
  if (t !== 'image' && VOID.has(n.tagName)) errors.push(`${at}: <${n.tagName}> can't hold ${t}`);
  if (t !== 'image' && loc && !loc.endTag) errors.push(`${at}: needs an explicit closing tag`);
  if (t === 'image' && !attr(n, 'alt')) warnings.push(`${at}: image has no alt text`);
  if (t === 'image' && (!attr(n, 'width') || !attr(n, 'height'))) warnings.push(`${at}: set width and height to prevent layout shift`);
  return t;
}

function walk(node, fn, ctx) {
  const next = fn(node, ctx) || ctx;
  const kids = node.tagName === 'template' ? node.content?.childNodes : node.childNodes;
  for (const k of kids || []) walk(k, fn, next);
}

for (const file of files(dir)) {
  const rel = path.relative(dir, file);
  const html = fs.readFileSync(file, 'utf8');
  const doc = parse(html, { sourceCodeLocationInfo: true });
  pages++;
  const keys = new Map();
  let regions = 0;
  let loader = null;

  walk(doc, (n, ctx) => {
    if (!n.tagName) return;
    if (n.tagName === 'script' && /cms\.srcs\.online\/loader\.js/.test(attr(n, 'src') || '')) loader = n;
    const key = attr(n, 'data-cms');
    const g = attr(n, 'data-cms-global');
    const field = attr(n, 'data-cms-field');
    const line = n.sourceCodeLocation?.startLine;

    if (field && !ctx.list) errors.push(`${rel}:${line}: data-cms-field="${field}" is outside a list`);
    if (field && ctx.list) {
      checkRegion(n, rel, `field "${field}"`);
      if (ctx.field) errors.push(`${rel}:${line}: field "${field}" is nested inside field "${ctx.field}"`);
      return { ...ctx, field };
    }
    if (!key && !g) return;
    if (key && g) errors.push(`${rel}:${line}: use data-cms or data-cms-global, not both`);
    const k = key || g;
    if (!KEY.test(k)) errors.push(`${rel}:${line}: invalid key "${k}" (letters, digits, - _ . : only)`);
    if (ctx.region) { errors.push(`${rel}:${line}: "${k}" is inside another editable area ("${ctx.region}")`); return; }
    const t = checkRegion(n, rel, `"${k}"`);
    regions++;
    if (key) {
      if (keys.has(key)) errors.push(`${rel}:${line}: duplicate key "${key}" (also line ${keys.get(key)})`);
      keys.set(key, line);
    } else {
      if (!globals.has(g)) globals.set(g, new Set());
      globals.get(g).add(t);
    }
    if (t === 'list') {
      const items = n.childNodes.filter((c) => c.tagName);
      if (!items.length) errors.push(`${rel}:${line}: list "${k}" needs at least one item`);
      const shapes = new Set(items.map((c) => c.tagName));
      if (shapes.size > 1) warnings.push(`${rel}:${line}: list "${k}" mixes <${[...shapes].join('>, <')}> items`);
      return { ...ctx, region: k, list: k };
    }
    return { ...ctx, region: k };
  }, {});

  regionCount += regions;
  if (regions && !loader) errors.push(`${rel}: has editable areas but no CMS loader script`);
  if (loader && siteKey && attr(loader, 'data-site') !== siteKey) errors.push(`${rel}: loader data-site="${attr(loader, 'data-site')}" should be "${siteKey}"`);
  if (loader && !attr(loader, 'data-site')) errors.push(`${rel}: loader is missing data-site`);
  if (/\{\{[A-Z0-9_]+\}\}/.test(html)) warnings.push(`${rel}: still has {{PLACEHOLDER}} text`);
}

for (const [g, types] of globals) if (types.size > 1) errors.push(`global "${g}" has different types on different pages: ${[...types].join(', ')}`);

console.log(`Checked ${pages} page(s), ${regionCount} editable area(s), ${globals.size} global(s).`);
for (const w of warnings) console.log('  warning:', w);
for (const e of errors) console.log('  ERROR:', e);
if (errors.length) { console.log(`\n${errors.length} error(s). Fix these before connecting the site.`); process.exit(1); }
console.log(errors.length || warnings.length ? '\nNo errors.' : '\nAll good.');
