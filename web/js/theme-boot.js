// Classic script loaded in <head> so the saved theme is on <html> before the first paint; a module
// would run after it and flash the wrong theme. Keep the key and rules in step with lib/theme.js,
// which owns everything after load.
(function () {
  var pref = 'system';
  try {
    var saved = localStorage.getItem('postern.theme');
    if (saved === 'light' || saved === 'dark') pref = saved;
  } catch (e) {
    /* storage blocked: follow the system */
  }
  var dark = pref === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : pref === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
