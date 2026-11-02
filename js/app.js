/*
 * 应用入口：状态、默认值、事件接线。
 * state = { container: {...}, rows: [{id, shape, name, values, qty, weight}], showErrors }
 */
(function (root) {
  'use strict';

  var CL = root.CL;
  var S = CL.shapes;
  var C = CL.containers;
  var V = CL.validate;
  var ST = CL.storage;

  var state = {
    container: C.get(C.defaultKey),
    rows: [],
    showErrors: false
  };
  var seq = 1;

  function newId() {
    return 'r' + (seq++);
  }

  function newRow(shapeKey) {
    var s = S.get(shapeKey || 'rect');
    return {
      id: newId(),
      shape: s.key,
      name: '',
      values: Object.assign({}, s.defaults),
      qty: '1',
      weight: ''
    };
  }

  /** 兼容旧存档：补齐缺字段，避免空值崩掉渲染 */
  function normalizeRow(raw) {
    var s = S.get(raw && raw.shape);
    var values = {};
    s.fields.forEach(function (f) {
      var v = raw && raw.values ? raw.values[f.key] : undefined;
      values[f.key] = v === undefined || v === null ? (s.defaults[f.key] || '') : String(v);
    });
    return {
      id: raw && raw.id ? String(raw.id) : newId(),
      shape: s.key,
      name: raw && raw.name ? String(raw.name) : '',
      values: values,
      qty: raw && raw.qty !== undefined && raw.qty !== null && raw.qty !== '' ? String(raw.qty) : '1',
      weight: raw && raw.weight !== undefined && raw.weight !== null ? String(raw.weight) : ''
    };
  }

  function defaultState() {
    var rows = [newRow('rect')];
    rows[0].values = { L: '400', W: '300', H: '300' };
    rows[0].qty = '100';
    return rows;
  }

  function bootstrap() {
    var saved = ST.load();
    if (saved) {
      state.container = Object.assign(C.get(saved.container.key || C.defaultKey), saved.container);
      state.rows = saved.rows.map(normalizeRow);
      if (!state.rows.length) state.rows = defaultState();
    } else {
      state.rows = defaultState();
    }

    var rowsUI = CL.ui.skuRows.mount(state, {
      onChange: function () {
        ST.save(state);
        CL.ui.result.markStale();
      },
      onDelete: function (row) {
        state.rows = state.rows.filter(function (r) { return r.id !== row.id; });
        ST.save(state);
        rowsUI.renderAll();
        CL.ui.result.markStale();
      },
      onShape: function (row, nextKey) {
        var next = S.get(nextKey);
        var merged = {};
        next.fields.forEach(function (f) {
          var keep = row.values[f.key];
          merged[f.key] = keep === undefined || keep === null || keep === '' ? next.defaults[f.key] : keep;
        });
        row.shape = next.key;
        row.values = merged;
        ST.save(state);
        rowsUI.renderAll();
        CL.ui.result.markStale();
      }
    });

    var panel = CL.ui.containerPanel.mount(state, {
      onChange: function () {
        ST.save(state);
        rowsUI.syncAll();
        CL.ui.result.markStale();
      }
    });

    document.getElementById('add-sku').addEventListener('click', function () {
      var row = newRow('rect');
      state.rows.push(row);
      ST.save(state);
      rowsUI.renderAll();
      var el = document.querySelector('.sku-card[data-id="' + row.id + '"]');
      if (el) {
        el.classList.add('flash');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var nameInput = el.querySelector('.sku-name');
        if (nameInput) nameInput.focus({ preventScroll: true });
        setTimeout(function () { el.classList.remove('flash'); }, 900);
      }
      CL.ui.result.markStale();
    });

    var pendingPack = null;

    function showViewer(pack) {
      var card = document.getElementById('viewer-card');
      var host = document.getElementById('viewer-canvas');
      card.classList.remove('hidden');
      if (!root.CL3D) {
        // viewer.js 是 module，正常会在 DOMContentLoaded 之前执行完；没加载成功时给个说明
        host.innerHTML = '<div class="viewer-error">3D 模块没有加载成功，刷新页面再试。</div>';
        return;
      }
      if (!root.CL3D.isReady() && !root.CL3D.init(host)) return;
      root.CL3D.build(pack);
    }

    function hideViewer() {
      document.getElementById('viewer-card').classList.add('hidden');
      pendingPack = null;
    }

    root.addEventListener('cl3d-ready', function () {
      if (!pendingPack) return;
      var p = pendingPack;
      pendingPack = null;
      var host = document.getElementById('viewer-canvas');
      if (root.CL3D.init(host)) root.CL3D.build(p);
    });

    var layerSelect = document.getElementById('layer-select');
    if (layerSelect) {
      layerSelect.addEventListener('change', function (e) {
        if (root.CL3D) root.CL3D.setLayer(e.target.value);
      });
    }

    document.getElementById('calc-btn').addEventListener('click', function () {
      state.showErrors = true;
      panel.paintErrors();
      rowsUI.paintErrors();

      var res = V.all(state);
      var pack = res.ok ? CL.pack.run(state) : null;
      CL.ui.result.render(res, pack, state);

      if (pack) showViewer(pack);
      else hideViewer();

      var card = document.getElementById('result-card');
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    rowsUI.renderAll();
  }

  // 暴露给自检脚本（tools/browser-check.mjs）使用，不影响正常 UI
  CL.app = {
    state: state,
    validate: function () { return V.all(state); },
    addRow: function () {
      state.rows.push(newRow('rect'));
      return state.rows[state.rows.length - 1];
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
