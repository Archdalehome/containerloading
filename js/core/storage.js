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

  // 存档版本：
  //   1 — 早期，姿态开关默认关（存了 allowSide/allowFlip=false）
  //   2 — 默认不限方向；旧存档读出来时把两个开关重置为允许，否则老用户看不到新默认值
  var VERSION = 2;

  NS.storage = {
    ok: ok,
    save: function (state) {
      if (!ok) return;
      try {
        root.localStorage.setItem(KEY, JSON.stringify({
          v: VERSION,
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
        if (!data.v || data.v < VERSION) {
          // 旧存档：方向限制默认值变了，按新默认值走（用户仍可在界面上逐个关掉）
          data.rows = data.rows.map(function (r) {
            return Object.assign({}, r, { allowSide: true, allowFlip: true });
          });
          data.v = VERSION;
        }
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
