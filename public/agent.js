/*! SRCS website assistant · Sync Race Studios
   <script src="https://cms.srcs.online/agent.js" data-agent="your-key" async></script>
   Optional: data-target="#el" renders the chat inside that element instead of a floating button.
             data-open opens the floating chat on load. data-font="..." sets the font. */
(() => {
  const me = document.currentScript;
  const KEY = me && me.getAttribute('data-agent');
  if (!KEY || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(KEY)) return;
  const reg = (window.__srcsAgents = window.__srcsAgents || {});
  if (reg[KEY]) return;
  reg[KEY] = true;
  const API = new URL(me.src).origin + '/api/agent';
  const TARGET = me.getAttribute('data-target');
  const OPEN = me.hasAttribute('data-open');
  const FONT = me.getAttribute('data-font') || 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const STORE = 'srcs-agent:' + KEY;

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch { return null; } };
  const save = (s) => { try { sessionStorage.setItem(STORE, JSON.stringify(s)); } catch {} };
  const visitorId = () => {
    try { let v = localStorage.getItem('srcs-agent-v'); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('srcs-agent-v', v); } return v; } catch { return null; }
  };

  // Text with **bold**, https links, line breaks and "- " lists. Built from text nodes only.
  function rich(text) {
    const frag = document.createDocumentFragment();
    const inline = (line, into) => {
      const re = /(\*\*[^*]+\*\*|https:\/\/[^\s<>()]+[^\s<>().,!?;:'"])/g;
      let last = 0, m;
      while ((m = re.exec(line))) {
        if (m.index > last) into.append(line.slice(last, m.index));
        const t = m[0];
        if (t.startsWith('**')) into.append(h('strong', {}, t.slice(2, -2)));
        else into.append(h('a', { href: t, target: '_blank', rel: 'noopener noreferrer' }, t.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')));
        last = m.index + t.length;
      }
      if (last < line.length) into.append(line.slice(last));
    };
    let list = null, para = null;
    for (const raw of String(text).split('\n')) {
      const line = raw.trimEnd();
      const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (li) { para = null; if (!list) { list = h('ul'); frag.append(list); } const el = h('li'); inline(li[1], el); list.append(el); continue; }
      list = null;
      if (!line.trim()) { para = null; continue; }
      if (para) para.append(h('br')); else { para = h('p'); frag.append(para); }
      inline(line, para);
    }
    return frag;
  }

  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };

  const css = (accent, onAccent) => `
    :host{all:initial}
    *{box-sizing:border-box;font-family:${FONT}}
    .root{--a:${accent};--on:${onAccent};color:#1A1A1A;font-size:15px;line-height:1.5}
    .launch{position:fixed;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:10px;border:0;cursor:pointer;background:var(--a);color:var(--on);padding:13px 18px 13px 14px;border-radius:999px;box-shadow:0 10px 30px rgba(17,17,17,.22);font-size:15px;font-weight:500;min-height:48px}
    .launch:focus-visible,.panel button:focus-visible,.panel a:focus-visible{outline:3px solid #111;outline-offset:2px}
    textarea:focus{outline:none;border-color:var(--a);box-shadow:0 0 0 3px rgba(17,17,17,.08)}
    .launch svg{width:22px;height:22px}
    .right{right:20px}.left{left:20px}
    .panel{display:flex;flex-direction:column;background:#fff;overflow:hidden}
    .float{position:fixed;bottom:20px;z-index:2147483001;width:min(400px,calc(100vw - 32px));height:min(620px,calc(100vh - 40px));border-radius:18px;box-shadow:0 24px 60px rgba(17,17,17,.25);border:1px solid rgba(17,17,17,.08)}
    .inline{width:100%;height:100%;min-height:460px;border-radius:16px;border:1px solid rgba(17,17,17,.1)}
    header{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 18px;background:var(--a);color:var(--on)}
    header .who{flex:1;min-width:0}
    header b{display:block;font-size:15px;font-weight:600}
    header small{display:block;font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    header button{background:transparent;border:0;color:inherit;width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:22px;line-height:1}
    header button:hover{background:rgba(255,255,255,.15)}
    .log{flex:1;overflow-y:auto;padding:18px 16px 8px;display:flex;flex-direction:column;gap:10px;background:#FAFAF8;overscroll-behavior:contain}
    .msg{max-width:86%;padding:10px 14px;border-radius:16px;word-wrap:break-word;overflow-wrap:anywhere}
    .msg p{margin:0 0 6px}.msg p:last-child{margin:0}
    .msg ul{margin:4px 0;padding-left:18px}
    .msg a{color:inherit;text-decoration:underline;text-underline-offset:2px}
    .bot{align-self:flex-start;background:#fff;border:1px solid #ECEAE6;border-bottom-left-radius:6px}
    .me{align-self:flex-end;background:var(--a);color:var(--on);border-bottom-right-radius:6px;white-space:pre-wrap}
    .err{align-self:center;font-size:13px;color:#8C1D18;background:#FCEDEC;padding:8px 12px;border-radius:10px;text-align:center}
    .note{align-self:center;font-size:13px;color:#2F5D3F;background:#E8F2EB;padding:8px 12px;border-radius:10px}
    .book{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;background:var(--a);color:var(--on);text-decoration:none;padding:10px 16px;border-radius:999px;font-size:14px;font-weight:600}
    .dots{align-self:flex-start;display:flex;gap:4px;padding:14px 16px;background:#fff;border:1px solid #ECEAE6;border-radius:16px;border-bottom-left-radius:6px}
    .dots i{width:7px;height:7px;border-radius:50%;background:#9A958F;animation:b 1s infinite ease-in-out}
    .dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
    @keyframes b{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
    .chips{display:flex;flex-wrap:wrap;gap:8px;padding:4px 16px 10px;background:#FAFAF8}
    .chips button{border:1px solid #DDD9D3;background:#fff;color:#1A1A1A;padding:8px 12px;border-radius:999px;font-size:13px;cursor:pointer;text-align:left}
    .chips button:hover{border-color:var(--a)}
    form{display:flex;gap:8px;align-items:flex-end;padding:12px;border-top:1px solid #ECEAE6;background:#fff}
    textarea{flex:1;resize:none;border:1px solid #DDD9D3;border-radius:14px;padding:11px 14px;font-size:15px;line-height:1.4;max-height:120px;min-height:44px;color:#1A1A1A;background:#fff}
    form button{width:44px;height:44px;border-radius:50%;border:0;background:var(--a);color:var(--on);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}
    form button[disabled]{opacity:.45;cursor:default}
    .foot{font-size:11.5px;color:#6B6660;text-align:center;padding:0 12px 10px;background:#fff}
    .foot a{color:inherit}
    .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
    @media (max-width:520px){.float{inset:0;width:100%;height:100%;border-radius:0;bottom:0}.launch{bottom:14px}.right{right:14px}.left{left:14px}}
    @media (prefers-reduced-motion:reduce){.dots i{animation:none}}
  `;

  const icon = (d, size = 20) => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    s.append(p); return s;
  };
  const CHAT = 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z';
  const SEND = 'M5 12h14M13 6l6 6-6 6';
  const CAL = 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z';

  async function start() {
    let cfg;
    try {
      const r = await fetch(`${API}?op=config&agent=${encodeURIComponent(KEY)}`, { credentials: 'omit' });
      if (!r.ok) return;
      cfg = await r.json();
    } catch { return; }
    const accent = /^#[0-9a-f]{6}$/i.test(me.getAttribute('data-color') || '') ? me.getAttribute('data-color') : cfg.color;
    const onAccent = lum(accent) > 0.4 ? '#111111' : '#FFFFFF';

    const hostEl = TARGET ? document.querySelector(TARGET) : document.createElement('div');
    if (!hostEl) return;
    if (!TARGET) { hostEl.setAttribute('data-srcs-agent', KEY); document.body.append(hostEl); }
    const shadow = hostEl.attachShadow({ mode: 'open' });
    const root = h('div', { class: 'root' });
    shadow.append(h('style', {}, css(accent, onAccent)), root);

    const S = load() || { conversation: null, messages: [] };
    let busy = false, panel = null, launcher = null, log, input, sendBtn, chips;

    function add(m, persist = true) {
      if (persist) { S.messages.push(m); S.messages = S.messages.slice(-60); save(S); }
      if (!log) return;
      let el;
      if (m.role === 'user') el = h('div', { class: 'msg me' }, m.text);
      else if (m.role === 'error') el = h('div', { class: 'err', role: 'alert' }, m.text);
      else if (m.role === 'note') el = h('div', { class: 'note' }, m.text);
      else if (m.role === 'booking') el = h('a', { class: 'book', href: m.url, target: '_blank', rel: 'noopener' }, icon(CAL, 18), m.label);
      else { el = h('div', { class: 'msg bot' }); el.append(rich(m.text)); }
      log.append(el);
      log.scrollTop = log.scrollHeight;
    }

    // Cloudflare Turnstile, only when the assistant asks for it. Usually invisible;
    // shows a small check above the page only if Cloudflare needs one.
    let tsLoad = null;
    function human() {
      tsLoad = tsLoad || new Promise((ok, fail) => {
        if (window.turnstile) return ok();
        const sc = document.createElement('script');
        sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        sc.async = true; sc.onload = () => ok(); sc.onerror = () => { tsLoad = null; fail(new Error('check')); };
        document.head.append(sc);
      });
      return tsLoad.then(() => new Promise((ok, fail) => {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483002';
        document.body.append(box);
        const done = (fn, v) => { try { window.turnstile.remove(id); } catch {} box.remove(); fn(v); };
        const id = window.turnstile.render(box, {
          sitekey: cfg.challenge, appearance: 'interaction-only', action: 'chat',
          callback: (t) => done(ok, t), 'error-callback': () => done(fail, new Error('check')), 'timeout-callback': () => done(fail, new Error('check')),
        });
      }));
    }

    async function post(text, retry) {
      const payload = { conversation: S.conversation, pass: S.pass || null, visitor: visitorId(), message: text, page: { url: location.href.split('#')[0], title: document.title } };
      if (cfg.challenge && !S.pass) payload.turnstile = await human();
      const r = await fetch(`${API}?op=chat&agent=${encodeURIComponent(KEY)}`, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && d.challenge && retry && cfg.challenge) { S.pass = null; save(S); return post(text, false); }
      return { r, d };
    }

    async function send(text) {
      text = String(text || '').trim();
      if (!text || busy) return;
      busy = true; sendBtn.disabled = true; chips?.remove(); chips = null;
      input.value = ''; grow();
      add({ role: 'user', text });
      const dots = h('div', { class: 'dots', 'aria-label': 'Typing' }, h('i'), h('i'), h('i'));
      log.append(dots); log.scrollTop = log.scrollHeight;
      try {
        const { r, d } = await post(text, true);
        dots.remove();
        if (!r.ok) { add({ role: 'error', text: d.error || 'Something went wrong. Please try again.' }, false); return; }
        S.conversation = d.conversation; if (d.pass) S.pass = d.pass; save(S);
        add({ role: 'assistant', text: d.reply });
        if (d.booking) add({ role: 'booking', url: d.booking.url, label: d.booking.label });
        if (d.lead) add({ role: 'note', text: 'Your details were sent to the team.' });
      } catch (e) {
        dots.remove();
        add({ role: 'error', text: e && e.message === 'check' ? 'We couldn’t confirm you’re human. Please try again.' : 'Couldn’t connect. Check your connection and try again.' }, false);
      } finally {
        busy = false; sendBtn.disabled = false; input.focus();
      }
    }

    function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }

    function buildPanel(inline) {
      log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
      input = h('textarea', { rows: '1', placeholder: 'Type your question…', 'aria-label': 'Your message', maxlength: '1000' });
      input.addEventListener('input', grow);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
      sendBtn = h('button', { type: 'submit', 'aria-label': 'Send' }, icon(SEND));
      const form = h('form', { onsubmit: (e) => { e.preventDefault(); send(input.value); } }, input, sendBtn);
      const p = h('div', { class: 'panel ' + (inline ? 'inline' : 'float ' + cfg.position), role: inline ? 'region' : 'dialog', 'aria-label': `Chat with ${cfg.business}` },
        h('header', {},
          h('div', { class: 'who' }, h('b', {}, cfg.name), h('small', {}, cfg.business)),
          cfg.booking ? h('button', { type: 'button', title: cfg.booking.label, 'aria-label': cfg.booking.label, onclick: () => window.open(cfg.booking.url, '_blank', 'noopener') }, icon(CAL)) : null,
          S.messages.length ? h('button', { type: 'button', title: 'Start over', 'aria-label': 'Start a new chat', onclick: reset }, '↺') : null,
          inline ? null : h('button', { type: 'button', 'aria-label': 'Close chat', onclick: close }, '×')),
        log);
      add({ role: 'assistant', text: cfg.greeting }, false);
      for (const m of S.messages) add(m, false);
      if (!S.messages.length && cfg.suggestions?.length) {
        chips = h('div', { class: 'chips' }, cfg.suggestions.map((s) => h('button', { type: 'button', onclick: () => send(s) }, s)));
        p.append(chips);
      }
      p.append(form, h('div', { class: 'foot' }, 'AI assistant · answers can be wrong', cfg.privacy ? [' · ', h('a', { href: cfg.privacy, target: '_blank', rel: 'noopener' }, 'Privacy')] : null));
      if (!inline) p.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      return p;
    }

    function reset() {
      S.conversation = null; S.messages = []; save(S);
      const inline = !!TARGET;
      panel.replaceWith(panel = buildPanel(inline));
      input.focus();
    }

    function open() {
      if (panel) return;
      launcher.style.display = 'none';
      panel = buildPanel(false);
      root.append(panel);
      input.focus();
      try { S.open = true; save(S); } catch {}
    }
    function close() {
      panel?.remove(); panel = null; log = null;
      launcher.style.display = '';
      launcher.focus();
      S.open = false; save(S);
    }

    if (TARGET) { panel = buildPanel(true); root.append(panel); return; }
    launcher = h('button', { class: 'launch ' + cfg.position, type: 'button', 'aria-haspopup': 'dialog', onclick: open }, icon(CHAT, 22), cfg.launcher);
    root.append(launcher);
    if (OPEN || (S.open && innerWidth > 520)) open();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
