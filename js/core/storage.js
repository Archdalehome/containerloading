/*
 * 本地保存：刷新页面不丢输入。localStorage 不可用（隐私模式/本地文件）时静默降级。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  var KEY = 'containerloading.v1';

  function available() {
    try {
      var k = '__cl_test__';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  var ok = available();

  NS.storage = {
    ok: ok,
    save: function (state) {
      if (!ok) return;
      try {
        root.localStorage.setItem(KEY, JSON.stringify({
          v: 1,
          container: state.container,
          rows: state.rows
        }));
      } catch (e) { /* 忽略：配额或隐私模式 */ }
    },
    load: function () {
      if (!ok) return null;
      try {
        var raw = root.localStorage.getItem(KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (!data || !data.container || !Array.isArray(data.rows)) return null;
        return data;
      } catch (e) {
        return null;
      }
    },
    clear: function () {
      if (!ok) return;
      try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
