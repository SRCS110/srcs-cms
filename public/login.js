/*! SRCS CMS sign-in page. Every editor signs in with an email link plus an
   authenticator-app code (set up on first sign-in).
   The full sign-in lives only here, on cms.srcs.online. Client sites receive a
   pass that works for that one site for 12 hours; when it runs out, this page
   issues a new one without another email, as long as you're still signed in here. */
(() => {
  const q = new URLSearchParams(location.search);
  const site = q.get('site') || '';
  const ret = q.get('return') || '';
  const KEY = 'srcs-cms-auth';
  const $ = (id) => document.getElementById(id);
  const show = (id) => { for (const s of ['ask', 'sent', 'busy', 'fail', 'lost', 'out', 'mfa']) $(s).hidden = s !== id; };
  const b64e = (obj) => { const b = new TextEncoder().encode(JSON.stringify(obj)); let s = ''; b.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
    clear() { try { localStorage.removeItem(KEY); } catch {} },
  };
  const post = (path, body, token) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });

  const hash = new URLSearchParams(location.hash.slice(1));
  // Drop tokens from the address bar right away.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  if (q.has('signout')) { signOut(); return; }
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(site) || !/^https?:\/\//.test(ret)) { show('lost'); return; }

  if (hash.get('error') || hash.get('error_description')) {
    const desc = hash.get('error_description') || '';
    $('failMsg').textContent = /expired|invalid/i.test(desc) ? 'That sign-in link has expired or was already used. Links work once, for one hour.' : (desc || 'The sign-in link could not be used.');
    show('fail');
  } else if (hash.get('access_token')) {
    store.set({
      access_token: hash.get('access_token'),
      refresh_token: hash.get('refresh_token'),
      expires_at: Number(hash.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(hash.get('expires_in') || 3600),
    });
    finish();
  } else if (store.get()) {
    finish();
  } else {
    show('ask');
    $('email').focus();
  }

  async function freshSession(force) {
    const s = store.get();
    if (!s) return null;
    if (!force && s.expires_at * 1000 - Date.now() > 60_000) return s;
    if (!s.refresh_token) return null;
    const r = await post('/api/refresh', { refresh_token: s.refresh_token });
    if (!r.ok) { store.clear(); return null; }
    const n = await r.json();
    store.set(n);
    return n;
  }

  async function finish() {
    show('busy');
    try {
      let s = await freshSession(false);
      if (!s) { show('ask'); return; }
      let r = await post('/api/site-session', { site }, s.access_token);
      if (r.status === 401) { s = await freshSession(true); if (!s) { show('ask'); return; } r = await post('/api/site-session', { site }, s.access_token); }
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) { store.clear(); show('ask'); return; }
      if (r.status === 403 && data.code === 'mfa_required') { await startMfa(s.access_token); return; }
      if (!r.ok) throw new Error(data.error || 'You don’t have access to edit this site.');
      const target = new URL(ret);
      const ok = (data.site.domains || []).some((d) => String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') === target.host.toLowerCase());
      if (!ok) throw new Error('That return address isn’t part of this site.');
      target.hash = 'srcs-cms=' + b64e({ access_token: data.access_token, expires_at: data.expires_at });
      location.replace(target.href);
    } catch (e) {
      $('failMsg').textContent = e.message;
      show('fail');
    }
  }

  // Two-step sign-in for Sync Race Studios admins: scan once, then a code each sign-in.
  let mfaFactor = null;
  async function startMfa(token) {
    $('mfaErr').hidden = true; $('mfaCode').value = '';
    const st = await (await post('/api/refresh', { mfa: 'status' }, token)).json();
    if (st.enrolled) {
      mfaFactor = st.factorId;
      $('mfaTitle').textContent = 'Enter your code';
      $('mfaIntro').textContent = 'Open your authenticator app and enter the 6-digit code for SRCS Editor.';
      $('mfaSetup').hidden = true;
    } else {
      const r = await post('/api/refresh', { mfa: 'enroll' }, token);
      const e = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(e.error || 'Couldn’t start two-step setup.');
      mfaFactor = e.factorId;
      $('mfaTitle').textContent = 'Set up two-step sign-in';
      $('mfaIntro').textContent = 'To keep your website safe, signing in to the editor needs a second step. Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password or Authy), scan this code with it, then enter the 6-digit code it shows. You only scan once.';
      if (/^data:image\/svg\+xml/.test(e.qr || '')) $('mfaQr').src = e.qr;
      $('mfaSecret').textContent = e.secret || '';
      $('mfaSetup').hidden = false;
    }
    show('mfa');
    $('mfaCode').focus();
  }
  $('mfaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('mfaCode').value.replace(/\s+/g, '');
    $('mfaErr').hidden = true;
    if (!/^\d{6}$/.test(code)) { $('mfaErr').textContent = 'Enter the 6-digit code from your authenticator app.'; $('mfaErr').hidden = false; return; }
    $('mfaSend').disabled = true;
    try {
      const s = await freshSession(false);
      if (!s) { show('ask'); return; }
      const r = await post('/api/refresh', { mfa: 'verify', factorId: mfaFactor, code }, s.access_token);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'That code didn’t work.');
      store.set(d);
      finish();
    } catch (err) {
      $('mfaErr').textContent = err.message; $('mfaErr').hidden = false;
    } finally { $('mfaSend').disabled = false; }
  });

  async function signOut() {
    const s = store.get();
    store.clear();
    if (s?.access_token) { try { await post('/api/refresh', { logout: true }, s.access_token); } catch {} }
    show('out');
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    $('formErr').hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('formErr').textContent = 'Enter a valid email address.'; $('formErr').hidden = false; return; }
    $('send').disabled = true;
    $('send').textContent = 'Sending…';
    try {
      const r = await fetch('/api/login-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, site, returnTo: ret }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Couldn’t send the link. Try again.');
      $('sentTo').textContent = email;
      show('sent');
    } catch (err) {
      $('formErr').textContent = err.message;
      $('formErr').hidden = false;
    } finally {
      $('send').disabled = false;
      $('send').textContent = 'Send sign-in link';
    }
  });
  $('again').addEventListener('click', () => { show('ask'); $('email').select(); });
  $('retry').addEventListener('click', () => { show('ask'); $('email').focus(); });
})();
