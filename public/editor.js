/*! SRCS CMS inline editor · Sync Race Studios */
(() => {
  if (window.__srcsCms) return;
  window.__srcsCms = true;

  const me = document.currentScript;
  const SITE = me.getAttribute('data-site');
  const API = me.getAttribute('data-api');
  const START = me.getAttribute('data-mode') || 'idle';
  const KEY = 'srcs-cms:' + SITE;
  const MAX_W = 2400;
  const PLAIN = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; })();

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const b64e = (obj) => { const b = new TextEncoder().encode(JSON.stringify(obj)); let s = ''; b.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const b64d = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))); };
  const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- auth
  const auth = {
    get() { try { const raw = localStorage.getItem(KEY); return raw ? b64d(raw) : null; } catch { return null; } },
    set(a) { try { localStorage.setItem(KEY, b64e(a)); } catch {} },
    clear() { try { localStorage.removeItem(KEY); } catch {} },
  };

  function loginUrl() {
    const ret = new URL(location.href);
    ret.hash = '';
    ret.searchParams.set('edit', '');
    return `${API}/login.html?site=${encodeURIComponent(SITE)}&return=${encodeURIComponent(ret.href)}`;
  }

  let refreshing = null;
  async function refresh() {
    const a = auth.get();
    if (!a?.refresh_token) throw Object.assign(new Error('Please sign in'), { status: 401 });
    if (!refreshing) {
      refreshing = fetch(API + '/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: a.refresh_token }) })
        .then(async (r) => { if (!r.ok) throw Object.assign(new Error('Session expired'), { status: 401 }); const s = await r.json(); auth.set(s); return s; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function api(method, path, body, retry = true) {
    let a = auth.get();
    if (!a) throw Object.assign(new Error('Please sign in'), { status: 401 });
    if (a.expires_at && a.expires_at * 1000 - Date.now() < 60_000) a = await refresh();
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bearer ' + a.access_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry) { await refresh(); return api(method, path, body, false); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
    return data;
  }

  // ---------------------------------------------------------------- page styles
  const pageCss = `
    html.srcs-on [data-srcs-ed]{outline:1px dashed rgba(196,98,58,.75)!important;outline-offset:3px!important;cursor:text!important;transition:outline-color .15s}
    html.srcs-on [data-srcs-ed]:hover{outline-style:solid!important}
    html.srcs-on [data-srcs-ed][data-srcs-dirty]{outline:1px solid #A24C29!important}
    html.srcs-on [data-srcs-ed="sel"]{outline:2px solid #C4623A!important;outline-offset:4px!important;background-color:rgba(196,98,58,.05)}
    html.srcs-on img[data-srcs-ed],html.srcs-on [data-srcs-kind="list"]{cursor:pointer!important}
    html.srcs-on [data-srcs-kind="list"]>*{outline:1px dotted rgba(196,98,58,.35);outline-offset:2px}
    html.srcs-on [data-srcs-ed]:focus{outline:2px solid #C4623A!important}
    html.srcs-on{scroll-padding-bottom:120px}
    body.srcs-pad{padding-bottom:96px!important}
  `;

  const uiCss = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646}
    .bar{pointer-events:auto;position:fixed;left:8px;right:8px;bottom:16px;margin:0 auto;width:max-content;max-width:calc(100vw - 16px);display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px;background:#111;color:#FBF8F4;padding:8px 8px 8px 14px;box-shadow:0 14px 36px rgba(17,17,17,.3);font-size:13px}
    .mark{display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:.08em;font-size:11px;color:#CFC8BE}
    .seg{display:flex;background:#262626;padding:3px}
    .seg button{background:transparent;color:#CFC8BE;border:0;padding:7px 12px;font-size:13px;cursor:pointer;min-height:34px}
    .seg button[aria-pressed="true"]{background:#FBF8F4;color:#111}
    .label{color:#CFC8BE;min-width:150px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .label .over{color:#F3A07A;font-weight:600}
    .count{min-width:72px}
    .btn{border:1px solid #444;background:none;color:#FBF8F4;padding:8px 12px;font-size:13px;cursor:pointer;min-height:38px}
    .btn:hover{border-color:#777}
    .btn.ghost{border-color:transparent;color:#CFC8BE}
    .btn.primary{background:#C4623A;border-color:#C4623A;color:#fff;letter-spacing:.08em;font-weight:600;padding:8px 18px}
    .btn.primary:hover{background:#A24C29;border-color:#A24C29}
    .btn[disabled]{opacity:.45;cursor:default}
    .pill{display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:13px}
    .pill i{width:8px;height:8px;border-radius:50%;display:inline-block}
    .pill.busy{background:#3A2A22;color:#F2C9B5}.pill.busy i{background:#E08A63;animation:p 1s infinite alternate}
    .pill.live{background:#1F3328;color:#BFE3CC}.pill.live i{background:#5DBB86}
    .pill.fail{background:#3A2222;color:#F2B5B5}.pill.fail i{background:#E06363}
    @keyframes p{to{opacity:.3}}
    .fab{pointer-events:auto;position:fixed;right:16px;bottom:16px;background:#111;color:#FBF8F4;border:0;padding:12px 16px;font-size:13px;cursor:pointer;box-shadow:0 10px 28px rgba(17,17,17,.28);display:flex;gap:8px;align-items:center;min-height:44px}
    .pop{pointer-events:auto;position:fixed;background:#fff;color:#111;border:1px solid #E2DBD1;box-shadow:0 14px 36px rgba(17,17,17,.18);padding:10px;font-size:13px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:min(420px,calc(100vw - 16px))}
    .pop button{border:1px solid #D9D2C7;background:#fff;color:#111;min-width:34px;min-height:34px;padding:0 10px;cursor:pointer;font-size:13px}
    .pop button:hover{border-color:#C4623A}
    .pop button.go{background:#C4623A;border-color:#C4623A;color:#fff}
    .pop label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#555;width:100%}
    .pop input{border:1px solid #D9D2C7;padding:8px;font-size:14px;width:100%;color:#111;background:#fff}
    .pop .row{display:flex;gap:6px;width:100%;align-items:center}
    .pop .thumb{width:100%;max-height:140px;object-fit:contain;background:#F4EFE8}
    .pop .note{font-size:12px;color:#666;width:100%}
    .pop .err{font-size:12px;color:#B3261E;width:100%}
    .panel{pointer-events:auto;position:fixed;top:0;right:0;bottom:0;width:min(380px,100vw);background:#fff;color:#111;border-left:1px solid #E2DBD1;box-shadow:-12px 0 32px rgba(17,17,17,.12);display:flex;flex-direction:column}
    .panel header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #ECE6DD}
    .panel h2{margin:0;font-size:14px;letter-spacing:.12em;font-weight:600}
    .panel .body{overflow:auto;flex:1}
    .panel .x{border:0;background:none;font-size:22px;width:44px;height:44px;cursor:pointer;color:#444}
    .item{padding:14px 18px;border-bottom:1px solid #F0EAE2;display:flex;flex-direction:column;gap:6px;font-size:13px}
    .item .meta{display:flex;justify-content:space-between;color:#666;font-size:12px}
    .item .what{color:#222;font-size:14px}
    .item .acts{display:flex;justify-content:flex-end;gap:8px}
    .item button,.panel form button{border:1px solid #D9D2C7;background:#fff;padding:7px 12px;font-size:12px;cursor:pointer;min-height:32px;color:#111}
    .panel form{padding:16px 18px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid #ECE6DD}
    .panel form input,.panel form select{border:1px solid #D9D2C7;padding:9px;font-size:14px;width:100%;background:#fff;color:#111}
    .panel form button.go{background:#111;color:#fff;border-color:#111;min-height:40px}
    .empty{padding:24px 18px;color:#666;font-size:13px}
    .toast{pointer-events:auto;position:fixed;left:8px;right:8px;margin:0 auto;width:max-content;bottom:84px;background:#fff;color:#222;border:1px solid #E2DBD1;padding:11px 16px;font-size:14px;box-shadow:0 10px 28px rgba(17,17,17,.14);max-width:calc(100vw - 24px)}
    .toast.error{border-color:#E7B4B0;color:#8C1D18}
    .scrim{pointer-events:auto;position:fixed;inset:0;background:rgba(17,17,17,.35);display:flex;align-items:center;justify-content:center;padding:16px}
    .dialog{background:#fff;color:#111;max-width:440px;width:100%;padding:24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 18px 48px rgba(17,17,17,.2)}
    .dialog h3{margin:0;font-size:17px}
    .dialog p{margin:0;font-size:14px;line-height:1.55;color:#444}
    .dialog .acts{display:flex;justify-content:flex-end;gap:8px}
    .dialog button{border:1px solid #D9D2C7;background:#fff;padding:10px 14px;font-size:13px;cursor:pointer;min-height:40px;color:#111}
    .dialog button.go{background:#C4623A;border-color:#C4623A;color:#fff}
    .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
    @media (max-width:640px){.label,.mark{display:none}.bar{bottom:8px;gap:6px;padding:6px}.btn{padding:8px 10px}.btn.primary{padding:8px 14px}}
  `;

  const logo = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
    const p1 = document.createElementNS(ns, 'path'); p1.setAttribute('d', 'M2 8h4V4h4v4h4'); p1.setAttribute('fill', 'none'); p1.setAttribute('stroke', '#E08A63'); p1.setAttribute('stroke-width', '1.6');
    const p2 = document.createElementNS(ns, 'path'); p2.setAttribute('d', 'M6 8v4h4'); p2.setAttribute('fill', 'none'); p2.setAttribute('stroke', '#FBF8F4'); p2.setAttribute('stroke-width', '1.6');
    svg.append(p1, p2);
    return svg;
  };

  // ---------------------------------------------------------------- state
  const S = {
    mode: 'off',          // off | idle | edit | preview
    session: null,
    regions: [],          // { el, key, global, type, orig, max, multiline, mirrors[] }
    sel: null,            // { el, region, field }
    status: 'idle',       // idle | saving | building | live | failed
    commit: null,
    panel: null,          // history | team | null
  };

  // ---------------------------------------------------------------- region model
  const typeOf = (el) => {
    const t = el.getAttribute('data-cms-type');
    if (t && ['text', 'rich', 'link', 'image', 'list'].includes(t)) return t;
    return el.tagName === 'IMG' ? 'image' : 'text';
  };
  // Browsers switch editable elements to pre-wrap, so this is read once, before editing starts.
  const isMultiline = (el) => {
    const v = el.getAttribute('data-srcs-ml');
    if (v != null) return v === '1';
    const ml = /^pre/.test(getComputedStyle(el).whiteSpace);
    el.setAttribute('data-srcs-ml', ml ? '1' : '0');
    return ml;
  };
  const INLINE_HOST = /^(P|H[1-6]|SPAN|A|BUTTON|LABEL|STRONG|EM|B|I|SMALL|FIGCAPTION|TD|TH|DT|DD|CITE|Q|SUMMARY|LEGEND|CAPTION)$/;

  function valueOf(el, type) {
    switch (type) {
      // Single-line text renders with collapsed whitespace, so save it that way.
      case 'text': return isMultiline(el) ? el.innerText.replace(/\r/g, '') : el.textContent.replace(/\s+/g, ' ').trim();
      case 'rich': return el.innerHTML;
      case 'link': return { text: el.textContent.replace(/\s+/g, ' ').trim(), href: el.getAttribute('href') || '' };
      case 'image': return { src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '', width: el.getAttribute('width') || undefined, height: el.getAttribute('height') || undefined };
      default: return null;
    }
  }

  function fieldsOf(item) {
    const out = {};
    for (const f of item.querySelectorAll('[data-cms-field]')) out[f.getAttribute('data-cms-field')] = { type: typeOf(f), value: valueOf(f, typeOf(f)) };
    return out;
  }

  function listValue(region) {
    return [...region.el.children].map((ch) => {
      const src = Number(ch.getAttribute('data-cms-src'));
      const now = fieldsOf(ch);
      const base = region.templates[src] || {};
      const fields = {};
      for (const [k, v] of Object.entries(now)) if (JSON.stringify(v.value) !== JSON.stringify(base[k]?.value)) fields[k] = v;
      return Object.keys(fields).length ? { src, fields } : { src };
    });
  }

  function snapshot(region) {
    if (region.type === 'list') {
      [...region.el.children].forEach((ch, i) => ch.setAttribute('data-cms-src', String(i)));
      region.templates = [...region.el.children].map(fieldsOf);
      region.orig = JSON.stringify(listValue(region));
    } else {
      region.orig = JSON.stringify(valueOf(region.el, region.type));
    }
  }

  const current = (region) => JSON.stringify(region.type === 'list' ? listValue(region) : valueOf(region.el, region.type));
  const isDirty = (region) => current(region) !== region.orig;

  function scan(allowed) {
    const seenGlobal = new Map();
    S.regions = [];
    for (const el of document.querySelectorAll('[data-cms],[data-cms-global]')) {
      if (el.parentElement && el.parentElement.closest('[data-cms-type="list"]')) continue;
      if (el.closest('[data-srcs-ui]')) continue;
      const key = el.getAttribute('data-cms') || el.getAttribute('data-cms-global');
      const global = !el.hasAttribute('data-cms');
      if (allowed && !allowed.has((global ? 'g:' : 'k:') + key)) continue;
      if (global && seenGlobal.has(key)) { seenGlobal.get(key).mirrors.push(el); continue; }
      const region = { el, key, global, type: typeOf(el), max: Number(el.getAttribute('data-cms-max')) || 0, mirrors: [] };
      if (region.type === 'list') el.querySelectorAll('[data-cms-field]').forEach(isMultiline);
      region.multiline = region.type === 'text' && isMultiline(el);
      snapshot(region);
      if (global) seenGlobal.set(key, region);
      S.regions.push(region);
    }
  }

  const regionFor = (el) => S.regions.find((r) => r.el === el || r.mirrors.includes(el));
  const labelFor = (r) => r.el.getAttribute('data-cms-label') || r.key.replace(/[-_]/g, ' ');

  function editableTargets() {
    const out = [];
    for (const r of S.regions) {
      if (r.type === 'list') {
        r.el.setAttribute('data-srcs-kind', 'list');
        for (const f of r.el.querySelectorAll('[data-cms-field]')) out.push([f, typeOf(f), r]);
      } else {
        out.push([r.el, r.type, r]);
        for (const m of r.mirrors) out.push([m, r.type, r]);
      }
    }
    return out;
  }

  function setEditable(on) {
    for (const [el, type] of editableTargets()) {
      if (on) {
        el.setAttribute('data-srcs-ed', '');
        if (type === 'text' || type === 'link') { el.contentEditable = PLAIN ? 'plaintext-only' : 'true'; blockCount.set(el, blocks(el)); }
        else if (type === 'rich') el.contentEditable = 'true';
        if (type === 'image') { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', 'Edit image'); }
        el.spellcheck = true;
      } else {
        el.removeAttribute('data-srcs-ed');
        el.removeAttribute('data-srcs-dirty');
        if (el.isContentEditable || el.hasAttribute('contenteditable')) el.removeAttribute('contenteditable');
        if (type === 'image') { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label'); }
      }
    }
    for (const r of S.regions) if (r.type === 'list' && !on) r.el.removeAttribute('data-srcs-kind');
    document.documentElement.classList.toggle('srcs-on', on);
  }

  // ---------------------------------------------------------------- UI shell
  const host = h('div', { 'data-srcs-ui': '' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(h('style', { text: uiCss }));
  const layer = h('div', { class: 'layer' });
  shadow.append(layer);
  const pageStyle = h('style', { 'data-srcs-ui': '', text: pageCss });

  const ui = {};
  function mountShell() {
    if (!host.isConnected) { document.documentElement.append(host); document.head.append(pageStyle); }
  }

  function toast(msg, kind) {
    ui.toast?.remove();
    ui.toast = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: 'status' }, msg);
    layer.append(ui.toast);
    const t = ui.toast;
    t.style.bottom = (ui.bar ? ui.bar.offsetHeight + 28 : 24) + 'px';
    setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
  }

  function dialog({ title, body, ok = 'OK', cancel = 'Cancel', danger }) {
    return new Promise((resolve) => {
      const close = (v) => { scrim.remove(); resolve(v); };
      const okBtn = h('button', { class: 'go', onclick: () => close(true) }, ok);
      const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(false); } },
        h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('h3', {}, title), h('p', {}, body),
          h('div', { class: 'acts' }, cancel ? h('button', { onclick: () => close(false) }, cancel) : null, okBtn)));
      if (danger) okBtn.style.background = '#8C1D18';
      layer.append(scrim);
      okBtn.focus();
    });
  }

  // Signed-in, not editing: a small button to start.
  function renderIdle() {
    clearUi();
    ui.fab = h('button', { class: 'fab', type: 'button', onclick: () => enterEdit() }, logo(), 'Edit this page');
    layer.append(ui.fab);
  }

  function clearUi() {
    for (const k of ['fab', 'bar', 'pop', 'panel']) { ui[k]?.remove(); ui[k] = null; }
    S.panel = null;
  }

  function renderBar() {
    ui.bar?.remove();
    const dirty = S.regions.filter(isDirty);
    dirty.forEach((r) => markDirty(r, true));
    S.regions.filter((r) => !dirty.includes(r)).forEach((r) => markDirty(r, false));
    const n = dirty.length;
    const role = S.session?.user?.role;
    const status = S.status;

    let label;
    if (S.mode === 'preview') label = 'Previewing as a visitor';
    else if (S.sel) {
      const r = S.sel.region;
      const len = r.max && r.type === 'text' ? (r.el.textContent || '').trim().length : 0;
      const base = S.sel.field ? `${labelFor(r)} › ${S.sel.field}` : labelFor(r);
      label = h('span', {}, base, r.max ? h('span', { class: len > r.max ? 'over' : '' }, ` · ${len}/${r.max}`) : null, r.global ? ' · every page' : null);
    } else label = S.regions.length ? 'Click any outlined area to edit' : 'Nothing on this page is editable';

    const pill = status === 'saving' ? h('div', { class: 'pill busy', role: 'status' }, h('i'), 'Saving…')
      : status === 'building' ? h('div', { class: 'pill busy', role: 'status' }, h('i'), 'Publishing · about a minute')
      : status === 'live' ? h('div', { class: 'pill live', role: 'status' }, h('i'), 'Live')
      : status === 'failed' ? h('div', { class: 'pill fail', role: 'status' }, h('i'), 'Publish failed')
      : null;

    ui.bar = h('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Site editor' },
      h('div', { class: 'mark' }, logo(), 'EDITOR'),
      h('div', { class: 'seg' },
        h('button', { type: 'button', 'aria-pressed': String(S.mode === 'edit'), onclick: () => setMode('edit') }, 'Edit'),
        h('button', { type: 'button', 'aria-pressed': String(S.mode === 'preview'), onclick: () => setMode('preview') }, 'Preview')),
      h('div', { class: 'label', 'aria-live': 'polite' }, label),
      h('div', { class: 'count' }, n === 0 ? 'No changes' : n === 1 ? '1 change' : `${n} changes`),
      n ? h('button', { class: 'btn ghost', type: 'button', onclick: discard }, 'Discard') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => openPanel('history') }, 'History'),
      role === 'owner' || role === 'admin' ? h('button', { class: 'btn', type: 'button', onclick: () => openPanel('team') }, 'Team') : null,
      pill,
      status !== 'saving' ? h('button', { class: 'btn primary', type: 'button', disabled: n ? null : true, onclick: publish, title: 'Publish (Ctrl/⌘+S)' }, 'PUBLISH') : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: exitEdit, title: 'Stop editing' }, 'Done'),
      h('button', { class: 'btn ghost', type: 'button', onclick: signOut }, 'Sign out'));
    layer.append(ui.bar);
  }

  function markDirty(r, on) {
    const els = r.type === 'list' ? [r.el] : [r.el, ...r.mirrors];
    for (const el of els) on ? el.setAttribute('data-srcs-dirty', '') : el.removeAttribute('data-srcs-dirty');
  }

  // ---------------------------------------------------------------- floating tools
  function place(pop, el, prefer = 'above') {
    const r = el.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = prefer === 'above' ? r.top - ph - 10 : r.bottom + 10;
    if (top < 8) top = r.bottom + 10;
    if (top + ph > innerHeight - 80) top = Math.max(8, r.top - ph - 10);
    const left = Math.min(Math.max(8, r.left), innerWidth - pw - 8);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function showPop(el, build, prefer) {
    ui.pop?.remove();
    ui.pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Edit options' });
    build(ui.pop);
    layer.append(ui.pop);
    ui.popFor = el;
    place(ui.pop, el, prefer);
  }

  function hidePop() { ui.pop?.remove(); ui.pop = null; ui.popFor = null; }

  addEventListener('scroll', () => { if (ui.pop && ui.popFor) place(ui.pop, ui.popFor); }, { passive: true, capture: true });
  addEventListener('resize', () => { if (ui.pop && ui.popFor) place(ui.pop, ui.popFor); });

  const cmd = (name, arg) => { document.execCommand(name, false, arg); afterInput(); };

  function richTools(el) {
    const keepSel = (e) => e.preventDefault(); // buttons must not steal the text selection
    showPop(el, (p) => {
      const b = (text, title, fn) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: keepSel, onclick: fn }, text);
      p.append(
        b('B', 'Bold', () => cmd('bold')),
        b('I', 'Italic', () => cmd('italic')),
        b('Link', 'Add link', () => linkPrompt(el)),
        b('Unlink', 'Remove link', () => cmd('unlink')),
        INLINE_HOST.test(el.tagName) ? null : b('• List', 'Bulleted list', () => cmd('insertUnorderedList')),
        b('Clear', 'Clear formatting', () => cmd('removeFormat')));
    });
  }

  function linkPrompt(el) {
    const sel = getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    if (!range || range.collapsed) { toast('Select the words to link first.'); return; }
    showPop(el, (p) => {
      const input = h('input', { type: 'url', placeholder: 'https://… or /page', 'aria-label': 'Link address' });
      const apply = () => {
        const v = input.value.trim();
        if (!v) return;
        if (!/^(https?:|mailto:|tel:|\/|#)/i.test(v)) { input.value = 'https://' + v; }
        el.focus();
        sel.removeAllRanges(); sel.addRange(range);
        cmd('createLink', input.value.trim());
        richTools(el);
      };
      p.append(h('label', {}, 'Link to', input), h('div', { class: 'row' }, h('button', { type: 'button', class: 'go', onclick: apply }, 'Add link'), h('button', { type: 'button', onclick: () => richTools(el) }, 'Cancel')));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      setTimeout(() => input.focus(), 0);
    });
  }

  function linkTools(el) {
    showPop(el, (p) => {
      const input = h('input', { type: 'text', value: el.getAttribute('href') || '', 'aria-label': 'Button link' });
      input.addEventListener('input', () => { el.setAttribute('href', input.value.trim()); afterInput(); });
      p.append(h('label', {}, 'Goes to', input), h('div', { class: 'note' }, 'Edit the words on the button directly. Use https://… for other sites or /page for this site.'));
    });
  }

  function imageTools(el) {
    showPop(el, (p) => {
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/avif,image/gif', class: 'sr', 'aria-label': 'Choose image' });
      const alt = h('input', { type: 'text', value: el.getAttribute('alt') || '', placeholder: 'Describe the photo for screen readers and Google', 'aria-label': 'Alt text' });
      const msg = h('div', { class: 'note' });
      alt.addEventListener('input', () => { el.setAttribute('alt', alt.value); afterInput(); });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        msg.className = 'note';
        msg.textContent = 'Optimizing and uploading…';
        try {
          const out = await uploadImage(f);
          el.removeAttribute('srcset');
          el.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
          el.setAttribute('src', out.url);
          el.setAttribute('width', String(out.width));
          el.setAttribute('height', String(out.height));
          msg.textContent = `Uploaded · ${out.width}×${out.height}, ${Math.round(out.bytes / 1024)} KB`;
          afterInput();
          place(ui.pop, el);
        } catch (e) {
          msg.className = 'err';
          msg.textContent = e.message || 'Upload failed';
        }
      });
      p.append(
        h('img', { class: 'thumb', src: el.currentSrc || el.getAttribute('src') || '', alt: '' }),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'go', onclick: () => file.click() }, 'Replace image'), file),
        h('label', {}, 'Alt text (required)', alt),
        msg);
    }, 'below');
  }

  function listTools(item, region) {
    showPop(item, (p) => {
      const kids = () => [...region.el.children];
      const b = (text, title, fn) => h('button', { type: 'button', title, 'aria-label': title, onclick: fn }, text);
      const refresh = () => { afterInput(); listTools(item, region); };
      p.append(
        h('span', { class: 'note', style: 'width:auto' }, `Item ${kids().indexOf(item) + 1} of ${kids().length}`),
        b('↑', 'Move up', () => { if (item.previousElementSibling) { item.parentNode.insertBefore(item, item.previousElementSibling); refresh(); } }),
        b('↓', 'Move down', () => { if (item.nextElementSibling) { item.parentNode.insertBefore(item.nextElementSibling, item); refresh(); } }),
        b('Duplicate', 'Duplicate item', () => { const c = item.cloneNode(true); c.removeAttribute('data-srcs-ed'); item.after(c); refresh(); }),
        b('Delete', 'Delete item', () => {
          if (kids().length <= 1) { toast('A list needs at least one item.'); return; }
          item.remove(); hidePop(); afterInput();
        }));
    }, 'above');
  }

  // ---------------------------------------------------------------- selection & input
  function locate(target) {
    if (!(target instanceof Element) || target.closest('[data-srcs-ui]')) return null;
    const field = target.closest('[data-cms-field]');
    if (field) {
      const listEl = field.closest('[data-cms-type="list"]');
      const region = listEl && regionFor(listEl);
      if (region) return { el: field, region, field: field.getAttribute('data-cms-field'), type: typeOf(field), item: [...listEl.children].find((c) => c.contains(field)) };
    }
    const el = target.closest('[data-cms],[data-cms-global]');
    if (el) {
      const region = regionFor(el);
      if (region && region.type !== 'list') return { el, region, type: region.type };
    }
    const listItem = target.closest('[data-cms-type="list"] > *');
    if (listItem) {
      const region = regionFor(listItem.parentElement);
      if (region) return { el: listItem, region, type: 'item', item: listItem };
    }
    return null;
  }

  function select(hit) {
    document.querySelectorAll('[data-srcs-ed="sel"]').forEach((e) => e.setAttribute('data-srcs-ed', ''));
    S.sel = hit;
    if (!hit) { hidePop(); renderBar(); return; }
    if (hit.el.hasAttribute('data-srcs-ed')) hit.el.setAttribute('data-srcs-ed', 'sel');
    if (hit.type === 'rich') richTools(hit.el);
    else if (hit.type === 'link') linkTools(hit.el);
    else if (hit.type === 'image') imageTools(hit.el);
    else if (hit.item) listTools(hit.item, hit.region);
    else hidePop();
    renderBar();
  }

  function afterInput() {
    const sel = S.sel;
    if (sel && !sel.field && sel.region.mirrors.length) {
      const src = sel.el;
      for (const m of [sel.region.el, ...sel.region.mirrors]) {
        if (m === src) continue;
        if (sel.region.type === 'rich') m.innerHTML = src.innerHTML; else m.textContent = src.textContent;
      }
    }
    renderBar();
  }

  const editing = () => S.mode === 'edit';

  document.addEventListener('click', (e) => {
    if (!editing() || e.composedPath().includes(host)) return;
    const hit = locate(e.target);
    // Links and buttons on the page must not navigate while editing.
    if (e.target.closest('a, button, [type=submit]')) e.preventDefault();
    if (hit) {
      if (!S.sel || S.sel.el !== hit.el) select(hit);
    } else {
      select(null);
    }
  }, true);

  document.addEventListener('submit', (e) => { if (editing()) e.preventDefault(); }, true);

  document.addEventListener('focusin', (e) => {
    if (!editing() || e.composedPath().includes(host)) return;
    const hit = locate(e.target);
    if (hit && (!S.sel || S.sel.el !== hit.el)) select(hit);
  });

  // Some keyboards, extensions and IMEs still sneak line breaks into single-line fields.
  const blockCount = new WeakMap();
  const blocks = (el) => el.querySelectorAll('div,p,br').length;
  function normalizePlain(hit) {
    const el = hit.el;
    if (!blockCount.has(el)) blockCount.set(el, 0);
    if (blocks(el) <= blockCount.get(el)) return;
    const multi = hit.type === 'text' && isMultiline(el);
    el.textContent = multi ? el.innerText.replace(/\r/g, '') : el.innerText.replace(/\s*[\r\n]+\s*/g, ' ').trimEnd();
    blockCount.set(el, 0);
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  document.addEventListener('input', (e) => {
    if (!editing()) return;
    const hit = locate(e.target);
    if (!hit) return;
    if (hit.type === 'text' || hit.type === 'link') normalizePlain(hit);
    afterInput();
  });

  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'edit' && S.mode !== 'preview') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); publish(); return; }
    if (e.key === 'Escape') { if (S.panel) closePanel(); else { document.activeElement?.blur?.(); select(null); } return; }
    if (!editing()) return;
    const hit = locate(e.target);
    if (!hit) return;
    if (hit.type === 'image' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); imageTools(hit.el); }
  }, true);

  // Line breaks and formatting are controlled here rather than on keydown, so it also
  // works with phone keyboards and IME input.
  document.addEventListener('beforeinput', (e) => {
    if (!editing()) return;
    const hit = locate(e.target);
    if (!hit) return;
    const plain = hit.type === 'text' || hit.type === 'link';
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      if (plain) {
        e.preventDefault();
        if (hit.type === 'text' && isMultiline(hit.el)) document.execCommand('insertText', false, '\n');
      } else if (hit.type === 'rich' && e.inputType === 'insertParagraph' && INLINE_HOST.test(hit.el.tagName)) {
        e.preventDefault();
        document.execCommand('insertLineBreak');
      }
      return;
    }
    if (plain && /^format/.test(e.inputType)) e.preventDefault();
    if (e.inputType === 'insertFromDrop') e.preventDefault();
  }, true);

  document.addEventListener('paste', (e) => {
    if (!editing()) return;
    const hit = locate(e.target);
    if (!hit || hit.type === 'image') return;
    e.preventDefault();
    let text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (hit.type !== 'rich' && !(hit.type === 'text' && isMultiline(hit.el))) text = text.replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  }, true);

  document.addEventListener('dragstart', (e) => { if (editing() && locate(e.target)) e.preventDefault(); }, true);

  addEventListener('beforeunload', (e) => {
    if (S.mode !== 'off' && S.mode !== 'idle' && S.regions.some(isDirty)) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------------------------------------------------------------- images
  async function decode(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

  async function optimize(file) {
    if (file.type === 'image/gif') return { blob: file, type: file.type, width: 0, height: 0 };
    const img = await decode(file);
    const w0 = img.width, h0 = img.height;
    if (!w0 || !h0) throw new Error('That file doesn’t look like an image');
    const scale = Math.min(1, MAX_W / w0);
    const width = Math.round(w0 * scale), height = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    let blob = await toBlob(canvas, 'image/webp', 0.82);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.85);
    if (scale === 1 && /^image\/(jpeg|webp)$/.test(file.type) && file.size < blob.size) blob = file;
    return { blob, type: blob.type, width, height };
  }

  async function uploadImage(file) {
    if (file.size > 30 * 1024 * 1024) throw new Error('That image is over 30 MB. Use a smaller file.');
    const out = await optimize(file);
    if (out.blob.size > 10 * 1024 * 1024) throw new Error('That image is still over 10 MB after optimizing.');
    const ticket = await api('POST', '/api/upload-url', { site: SITE, contentType: out.type, bytes: out.blob.size, width: out.width, height: out.height });
    const form = new FormData();
    form.append('cacheControl', '31536000');
    form.append('', out.blob);
    const res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { ...(ticket.headers || {}), 'x-upsert': 'false' }, body: form });
    if (!res.ok) throw new Error('Upload failed. Try again.');
    let { width, height } = out;
    if (!width) { const img = await decode(file); width = img.width; height = img.height; }
    return { url: ticket.publicUrl, width, height, bytes: out.blob.size };
  }

  // ---------------------------------------------------------------- publish
  function collect() {
    return S.regions.filter(isDirty).map((r) => ({
      key: r.key, global: r.global, type: r.type,
      value: r.type === 'list' ? listValue(r) : valueOf(r.el, r.type),
    }));
  }

  function problems() {
    const out = [];
    for (const r of S.regions.filter(isDirty)) {
      if (r.max && r.type === 'text' && r.el.textContent.trim().length > r.max) out.push(`“${labelFor(r)}” is over ${r.max} characters.`);
      if (r.type === 'text' && !r.el.textContent.trim()) out.push(`“${labelFor(r)}” is empty.`);
      if (r.type === 'image' && !(r.el.getAttribute('alt') || '').trim()) out.push(`Add alt text to “${labelFor(r)}”.`);
      if (r.type === 'link') {
        const href = (r.el.getAttribute('href') || '').trim();
        if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) out.push(`“${labelFor(r)}” needs a link starting with https://, /, mailto: or tel:.`);
      }
      if (r.type === 'list') {
        for (const img of r.el.querySelectorAll('img[data-cms-field]')) if (!(img.getAttribute('alt') || '').trim()) { out.push(`Add alt text to every image in “${labelFor(r)}”.`); break; }
      }
    }
    return out;
  }

  async function publish() {
    if (S.mode !== 'edit' && S.mode !== 'preview') return;
    if (S.status === 'saving') return;
    const changes = collect();
    if (!changes.length) { toast('No changes to publish yet.'); return; }
    const issues = problems();
    if (issues.length) { toast(issues[0], 'error'); return; }
    S.status = 'saving';
    hidePop();
    renderBar();
    try {
      const r = await api('POST', '/api/publish', { site: SITE, file: S.session.file, baseSha: S.session.sha, path: location.pathname, changes });
      S.session.sha = r.sha;
      S.regions.forEach(snapshot);
      if (!r.commit) { S.status = 'idle'; renderBar(); toast('Already up to date.'); return; }
      S.commit = r.commit;
      S.status = 'building';
      renderBar();
      watch(r.commit);
    } catch (e) {
      S.status = 'idle';
      renderBar();
      if (e.status === 409 && e.data?.code === 'conflict') {
        const ok = await dialog({ title: 'This page changed', body: 'Someone published changes to this page after you opened it. Reload to get the latest version, then make your edits again.', ok: 'Reload page', cancel: 'Not now' });
        if (ok) { S.regions.forEach(snapshot); location.reload(); }
      } else if (e.status === 401) {
        signInAgain();
      } else toast(e.message, 'error');
    }
  }

  async function watch(commit, { onLive } = {}) {
    for (let i = 0; i < 75; i++) {
      await sleep(i < 3 ? 6000 : 4000);
      if (S.commit !== commit) return; // a newer publish took over
      let state;
      try { state = (await api('GET', `/api/status?site=${encodeURIComponent(SITE)}&commit=${commit}`)).state; } catch { continue; }
      if (state === 'live') {
        S.status = 'live'; renderBar();
        onLive ? onLive() : toast('Your changes are live.');
        setTimeout(() => { if (S.commit === commit && S.status === 'live') { S.status = 'idle'; renderBar(); } }, 8000);
        return;
      }
      if (state === 'failed') {
        S.status = 'failed'; renderBar();
        toast('The site couldn’t be rebuilt. Your edit is saved in History; Sync Race Studios has been notified by the build system.', 'error');
        return;
      }
    }
    if (S.commit === commit) { S.status = 'idle'; renderBar(); toast('Still publishing. Check the live site in a few minutes.'); }
  }

  async function discard() {
    const ok = await dialog({ title: 'Discard changes?', body: 'Your unpublished edits on this page will be lost.', ok: 'Discard', danger: true });
    if (ok) { S.regions.forEach((r) => { r.orig = current(r); }); location.reload(); }
  }

  // ---------------------------------------------------------------- panels
  function closePanel() { ui.panel?.remove(); ui.panel = null; S.panel = null; }

  function panelShell(title) {
    closePanel();
    const body = h('div', { class: 'body' }, h('div', { class: 'empty' }, 'Loading…'));
    ui.panel = h('aside', { class: 'panel', role: 'dialog', 'aria-label': title },
      h('header', {}, h('h2', {}, title.toUpperCase()), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: closePanel }, '×')),
      body);
    layer.append(ui.panel);
    return body;
  }

  async function openPanel(kind) {
    hidePop();
    if (S.panel === kind) { closePanel(); return; }
    if (kind === 'history') await historyPanel(); else await teamPanel();
    S.panel = kind;
  }

  async function historyPanel() {
    const body = panelShell('History');
    try {
      const { edits } = await api('GET', `/api/history?site=${encodeURIComponent(SITE)}`);
      body.replaceChildren();
      if (!edits.length) { body.append(h('div', { class: 'empty' }, 'No edits yet. Published changes will show here.')); return; }
      for (const e of edits) {
        const what = e.kind === 'revert' ? `Restored an earlier version on ${e.page_path || '/'}` : `Edited ${(e.regions || []).join(', ')} on ${e.page_path || '/'}`;
        body.append(h('div', { class: 'item' },
          h('div', { class: 'meta' }, h('span', {}, e.editor_email || 'Unknown'), h('span', {}, fmtDate(e.created_at))),
          h('div', { class: 'what' }, what),
          e.commit_sha ? h('div', { class: 'acts' }, h('button', { type: 'button', onclick: () => revert(e) }, 'Undo this')) : null));
      }
    } catch (e) {
      body.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  async function revert(e) {
    const ok = await dialog({
      title: 'Undo this edit?',
      body: `This restores ${e.files?.length > 1 ? 'the affected pages' : 'the page'} to how ${e.files?.length > 1 ? 'they were' : 'it was'} just before ${fmtDate(e.created_at)}. Any changes made to the same ${e.files?.length > 1 ? 'pages' : 'page'} after that are undone too.`,
      ok: 'Undo edit',
    });
    if (!ok) return;
    try {
      const r = await api('POST', '/api/revert', { site: SITE, editId: e.id });
      closePanel();
      if (!r.commit) { toast(r.message || 'Nothing to restore.'); return; }
      S.commit = r.commit; S.status = 'building'; renderBar();
      watch(r.commit, { onLive: async () => {
        const go = await dialog({ title: 'Restored', body: 'The earlier version is live. Reload to see it here.', ok: 'Reload', cancel: 'Later' });
        if (go) { S.regions.forEach((x) => { x.orig = current(x); }); location.reload(); }
      } });
    } catch (err) { toast(err.message, 'error'); }
  }

  async function teamPanel() {
    const body = panelShell('Team');
    const role = S.session.user.role;
    const load = async () => {
      try {
        const { members, you } = await api('GET', `/api/members?site=${encodeURIComponent(SITE)}`);
        const email = h('input', { type: 'email', required: true, placeholder: 'name@business.com', 'aria-label': 'Email address' });
        const roleSel = role === 'admin' ? h('select', { 'aria-label': 'Role' }, h('option', { value: 'editor' }, 'Editor'), h('option', { value: 'owner' }, 'Owner')) : null;
        const form = h('form', { onsubmit: async (ev) => {
          ev.preventDefault();
          try {
            const r = await api('POST', '/api/members', { site: SITE, email: email.value, role: roleSel ? roleSel.value : 'editor' });
            toast(r.invited ? `Invite sent to ${email.value}.` : `${email.value} can now edit this site.`);
            load();
          } catch (err) { toast(err.message, 'error'); }
        } },
          h('div', { style: 'font-size:13px;color:#444' }, 'Invite someone to edit this site. They’ll get an email with a sign-in link.'),
          email, roleSel, h('button', { class: 'go', type: 'submit' }, 'Send invite'));
        body.replaceChildren(form);
        for (const m of members) {
          body.append(h('div', { class: 'item' },
            h('div', { class: 'meta' }, h('span', {}, m.role === 'owner' ? 'Owner' : 'Editor'), h('span', {}, m.user_id === you ? 'You' : '')),
            h('div', { class: 'what' }, m.email),
            m.user_id !== you && (m.role !== 'owner' || role === 'admin') ? h('div', { class: 'acts' }, h('button', { type: 'button', onclick: async () => {
              if (!(await dialog({ title: 'Remove access?', body: `${m.email} will no longer be able to edit this site.`, ok: 'Remove', danger: true }))) return;
              try { await api('DELETE', '/api/members', { site: SITE, userId: m.user_id }); load(); } catch (err) { toast(err.message, 'error'); }
            } }, 'Remove')) : null));
        }
      } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, e.message)); }
    };
    await load();
  }

  // ---------------------------------------------------------------- modes
  function setMode(mode) {
    if (mode === S.mode) return;
    S.mode = mode;
    if (mode === 'preview') { select(null); setEditable(false); }
    else setEditable(true);
    renderBar();
  }

  async function enterEdit() {
    if (!auth.get()) { location.href = loginUrl(); return; }
    mountShell();
    clearUi();
    toast('Loading editor…');
    try {
      S.session = await api('GET', `/api/session?site=${encodeURIComponent(SITE)}&path=${encodeURIComponent(location.pathname)}`);
    } catch (e) {
      if (e.status === 401) return signInAgain();
      if (e.status === 403) { toast(e.message, 'error'); renderIdle(); return; }
      if (e.status === 404) { toast('This page isn’t connected to the editor.', 'error'); renderIdle(); return; }
      toast(e.message, 'error'); renderIdle(); return;
    }
    const allowed = new Set((S.session.regions || []).map((r) => (r.global ? 'g:' : 'k:') + r.key));
    scan(allowed);
    S.mode = 'edit';
    setEditable(true);
    document.body.classList.add('srcs-pad');
    const url = new URL(location.href);
    if (!url.searchParams.has('edit')) { url.searchParams.set('edit', ''); history.replaceState(history.state, '', url); }
    ui.toast?.remove();
    renderBar();
    if (!S.regions.length) toast('Nothing on this page is set up for editing yet.');
  }

  async function exitEdit() {
    if (S.regions.some(isDirty)) {
      const ok = await dialog({ title: 'Leave without publishing?', body: 'You have changes that aren’t published. They’ll stay on this screen until you reload, but visitors won’t see them.', ok: 'Stop editing', cancel: 'Keep editing' });
      if (!ok) return;
    }
    select(null);
    setEditable(false);
    S.mode = 'idle';
    document.body.classList.remove('srcs-pad');
    const url = new URL(location.href);
    url.searchParams.delete('edit');
    history.replaceState(history.state, '', url);
    renderIdle();
  }

  async function signInAgain() {
    auth.clear();
    const ok = await dialog({ title: 'Please sign in again', body: 'Your session has ended. Sign in to keep editing.', ok: 'Sign in', cancel: 'Cancel' });
    if (ok) location.href = loginUrl(); else { setEditable(false); S.mode = 'off'; clearUi(); }
  }

  async function signOut() {
    if (S.regions.some(isDirty)) {
      const ok = await dialog({ title: 'Sign out?', body: 'Your unpublished changes will be lost.', ok: 'Sign out', danger: true });
      if (!ok) return;
    }
    auth.clear();
    S.regions.forEach((r) => { r.orig = current(r); });
    const url = new URL(location.href);
    url.searchParams.delete('edit');
    location.replace(url.href);
  }

  // ---------------------------------------------------------------- start
  const start = () => {
    mountShell();
    if (START === 'edit') enterEdit();
    else if (auth.get()) { S.mode = 'idle'; renderIdle(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
