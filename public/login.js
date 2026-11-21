/*! SRCS CMS sign-in page */
(() => {
  const q = new URLSearchParams(location.search);
  const site = q.get('site') || '';
  const ret = q.get('return') || '';
  const $ = (id) => document.getElementById(id);
  const show = (id) => { for (const s of ['ask', 'sent', 'busy', 'fail', 'lost']) $(s).hidden = s !== id; };
  const b64e = (obj) => { const b = new TextEncoder().encode(JSON.stringify(obj)); let s = ''; b.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(site) || !/^https?:\/\//.test(ret)) { show('lost'); return; }

  const hash = new URLSearchParams(location.hash.slice(1));
  // Drop tokens from the address bar right away.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  if (hash.get('error') || hash.get('error_description')) {
    const desc = hash.get('error_description') || '';
    $('failMsg').textContent = /expired|invalid/i.test(desc) ? 'That sign-in link has expired or was already used. Links work once, for one hour.' : (desc || 'The sign-in link could not be used.');
    show('fail');
  } else if (hash.get('access_token')) {
    finish({
      access_token: hash.get('access_token'),
      refresh_token: hash.get('refresh_token'),
      expires_at: Number(hash.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(hash.get('expires_in') || 3600),
    });
  } else {
    show('ask');
    $('email').focus();
  }

  async function finish(tokens) {
    show('busy');
    try {
      const r = await fetch('/api/session?site=' + encodeURIComponent(site), { headers: { Authorization: 'Bearer ' + tokens.access_token } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'You don’t have access to edit this site.');
      const target = new URL(ret);
      const ok = (data.site.domains || []).some((d) => String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') === target.host.toLowerCase());
      if (!ok) throw new Error('That return address isn’t part of this site.');
      target.hash = 'srcs-cms=' + b64e(tokens);
      location.replace(target.href);
    } catch (e) {
      $('failMsg').textContent = e.message;
      show('fail');
    }
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
