/*
 * 使用说明折叠条：默认收起，点击展开。
 * 用 button + aria-expanded + aria-controls 实现，键盘可达；展开状态记在 localStorage，
 * 首次访问（没有记录）保持收起，避免每次进来把首屏挤满。
 */
(function (root) {
  'use strict';

  var KEY = 'cl.help.open';

  function init() {
    var btn = document.getElementById('help-toggle');
    var body = document.getElementById('help-body');
    if (!btn || !body) return;

    function apply(open) {
      body.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      var arrow = btn.querySelector('.help-toggle-arrow');
      if (arrow) arrow.textContent = open ? '▴' : '▾';
    }

    var stored = null;
    try { stored = root.localStorage.getItem(KEY); } catch (e) { stored = null; }
    apply(stored === '1'); // 没记录 = 收起

    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      apply(open);
      try { root.localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
