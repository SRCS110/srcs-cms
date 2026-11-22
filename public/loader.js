/*! SRCS CMS loader. Does nothing for visitors; loads the editor for signed-in editors or ?edit. */
(function () {
  var s = document.currentScript, site = s && s.getAttribute('data-site');
  if (!site) return;
  var K = 'srcs-cms:' + site, l = location, edit = /[?&]edit(=|&|$)/.test(l.search), has = false, demo = s.hasAttribute('data-demo');
  try {
    var m = l.hash.match(/[#&]srcs-cms=([^&]+)/);
    if (m) {
      localStorage.setItem(K, m[1]);
      history.replaceState(null, '', l.pathname + l.search + l.hash.replace(m[0], ''));
      edit = true;
    }
    has = !!localStorage.getItem(K);
  } catch (e) {}
  if (!edit && !has && !demo) return;
  var e = document.createElement('script');
  e.src = new URL('editor.js', s.src).href;
  e.async = true;
  e.setAttribute('data-site', site);
  e.setAttribute('data-api', new URL(s.src).origin);
  e.setAttribute('data-mode', edit ? 'edit' : 'idle');
  if (demo) e.setAttribute('data-demo', '1');
  document.head.appendChild(e);
})();
