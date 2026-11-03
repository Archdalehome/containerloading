/*
 * 纸箱清单：每行一个箱型。形状切换时字段跟着换，删除后重新编号。
 * 输入即存到 state（字符串原样保留，校验时再解析）。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  var S = NS.shapes;
  var V = NS.validate;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function m3(mm3) {
    return (mm3 / 1e9).toFixed(3);
  }

  function tabsHTML(row) {
    var html = '<div class="shape-tabs" role="tablist" aria-label="箱型">';
    S.order.forEach(function (key) {
      var s = S.get(key);
      html += '<button type="button" class="shape-tab' + (row.shape === key ? ' active' : '') + '"' +
        ' data-shape="' + key + '" role="tab" aria-selected="' + (row.shape === key) + '">' +
        '<span class="shape-ico">' + s.icon + '</span>' + s.name + '</button>';
    });
    html += '</div>';
    return html;
  }

  function fieldsHTML(row) {
    var s = S.get(row.shape);
    var html = '<div class="fields">';
    s.fields.forEach(function (f) {
      var val = row.values[f.key] === undefined || row.values[f.key] === null ? '' : row.values[f.key];
      html += '<label class="field" data-field="' + f.key + '">' +
        '<span class="field-label">' + f.label + '</span>' +
        '<span class="input-wrap"><input type="number" class="v-input" data-key="' + f.key + '" step="1" min="0" inputmode="decimal" value="' + esc(val) + '"><i>mm</i></span>' +
        '</label>';
    });
    html += '</div>';
    return html;
  }

  function build(row, index, state, hooks) {
    var s = S.get(row.shape);
    var el = document.createElement('article');
    el.className = 'sku-card';
    el.dataset.id = row.id;

    el.innerHTML =
      '<div class="sku-head">' +
        '<span class="sku-index">' + (index + 1) + '</span>' +
        '<input class="sku-name" type="text" maxlength="40" placeholder="纸箱名称 / 型号（可选）" value="' + esc(row.name) + '">' +
        '<button type="button" class="icon-btn" data-act="delete" title="删除这一行" aria-label="删除这一行">' +
          '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>' +
        '</button>' +
      '</div>' +
      tabsHTML(row) +
      (s.note ? '<p class="shape-note">' + s.note + '</p>' : '') +
      fieldsHTML(row) +
      '<div class="sku-foot">' +
        '<label class="field mini" data-field="qty">' +
          '<span class="field-label">数量（箱）</span>' +
          '<span class="input-wrap"><input type="number" class="qty-input" step="1" min="1" inputmode="numeric" value="' + esc(row.qty) + '"></span>' +
        '</label>' +
        '<label class="field mini" data-field="weight">' +
          '<span class="field-label">单箱重（kg）</span>' +
          '<span class="input-wrap"><input type="number" class="weight-input" step="0.01" min="0" inputmode="decimal" placeholder="可选" value="' + esc(row.weight) + '"></span>' +
        '</label>' +
        '<div class="pose-toggles">' +
          '<label class="toggle" title="不勾就只按底面朝下摆（有「此面向上」标识的货请取消）"><input type="checkbox" class="opt-flip"' + (row.allowFlip ? ' checked' : '') + '> 允许倒放</label>' +
          '<label class="toggle" title="不勾就只按底面朝下摆（易碎、必须立着放的货请取消）"><input type="checkbox" class="opt-side"' + (row.allowSide ? ' checked' : '') + '> 允许侧放</label>' +
        '</div>' +
        '<div class="row-meta"></div>' +
      '</div>' +
      '<div class="row-errors" aria-live="polite"></div>';

    // 形状切换
    Array.prototype.forEach.call(el.querySelectorAll('.shape-tab'), function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.dataset.shape;
        if (next === row.shape) return;
        hooks.onShape(row, next);
      });
    });

    // 尺寸输入
    Array.prototype.forEach.call(el.querySelectorAll('.v-input'), function (inp) {
      inp.addEventListener('input', function () {
        row.values[inp.dataset.key] = inp.value;
        refreshMeta(el, row, state);
        if (state.showErrors) paint(el, row, state);
        hooks.onChange();
      });
    });

    el.querySelector('.sku-name').addEventListener('input', function (e) {
      row.name = e.target.value;
      hooks.onChange();
    });

    el.querySelector('.qty-input').addEventListener('input', function (e) {
      row.qty = e.target.value;
      refreshMeta(el, row, state);
      if (state.showErrors) paint(el, row, state);
      hooks.onChange();
    });

    el.querySelector('.weight-input').addEventListener('input', function (e) {
      row.weight = e.target.value;
      refreshMeta(el, row, state);
      if (state.showErrors) paint(el, row, state);
      hooks.onChange();
    });

    el.querySelector('.opt-flip').addEventListener('change', function (e) {
      row.allowFlip = e.target.checked;
      hooks.onChange();
    });

    el.querySelector('.opt-side').addEventListener('change', function (e) {
      row.allowSide = e.target.checked;
      hooks.onChange();
    });

    el.querySelector('[data-act="delete"]').addEventListener('click', function () {
      hooks.onDelete(row);
    });

    return el;
  }

  /** 实时摘要：净体积 / 外接体积 / 底面尺寸 */
  function refreshMeta(el, row, state) {
    var metaEl = el.querySelector('.row-meta');
    var s = S.get(row.shape);
    var errs = s.checks(row.values || {});
    if (errs.length) {
      metaEl.innerHTML = '<span class="meta-dim">尺寸未填完整</span>';
      return;
    }
    var sm = V.rowSummary(row);
    var ratio = S.fillRatio(row.shape, row.values);
    var parts = [];
    parts.push('净体积 ' + m3(sm.netVolume) + ' m³/箱');
    if (ratio < 0.9995) {
      parts.push('外接 ' + m3(sm.outerVolume) + ' m³/箱（净占 ' + Math.round(ratio * 100) + '%）');
    }
    parts.push('底面 ' + S.num(sm.bbox.l) + '×' + S.num(sm.bbox.w) + ' · 高 ' + S.num(sm.bbox.h));
    if (sm.qty > 0) {
      parts.push('合计 ' + m3(sm.netTotal) + ' m³');
    }
    metaEl.innerHTML = parts.map(function (t) { return '<span>' + t + '</span>'; }).join('<span class="dot">·</span>');
  }

  /** 按校验结果涂错误色 */
  function paint(el, row, state) {
    var errs = V.rowErrors(row, state.container);
    var byField = {};
    var general = [];
    errs.forEach(function (e) {
      if (e.field) {
        (byField[e.field] = byField[e.field] || []).push(e);
      } else {
        general.push(e);
      }
    });

    Array.prototype.forEach.call(el.querySelectorAll('.field'), function (fEl) {
      var key = fEl.dataset.field;
      var list = byField[key] || [];
      var hasError = list.some(function (e) { return e.level === 'error'; });
      fEl.classList.toggle('has-err', hasError);
      var input = fEl.querySelector('input');
      if (input) {
        input.classList.toggle('invalid', hasError);
        if (hasError) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    });

    var errBox = el.querySelector('.row-errors');
    errBox.innerHTML = '';
    var shown = {};
    general.concat(errs.filter(function (e) { return e.field; })).forEach(function (e) {
      if (e.level !== 'error') return;
      if (shown[e.message]) return;
      shown[e.message] = true;
      var p = document.createElement('p');
      p.className = 'err-line';
      p.textContent = e.message;
      errBox.appendChild(p);
    });
  }

  function mount(state, opts) {
    var hooks = {
      onChange: opts.onChange || function () {},
      onDelete: opts.onDelete || function () {},
      onShape: opts.onShape || function () {}
    };
    var listEl = document.getElementById('sku-list');
    var emptyEl = document.getElementById('sku-empty');

    function renderAll() {
      listEl.innerHTML = '';
      state.rows.forEach(function (row, i) {
        var el = build(row, i, state, hooks);
        listEl.appendChild(el);
        refreshMeta(el, row, state);
        if (state.showErrors) paint(el, row, state);
      });
      emptyEl.hidden = state.rows.length > 0;
    }

    /** 集装箱参数变了：刷新每行摘要与错误，不重建 DOM */
    function syncAll() {
      Array.prototype.forEach.call(listEl.children, function (el) {
        var row = state.rows.filter(function (r) { return r.id === el.dataset.id; })[0];
        if (!row) return;
        refreshMeta(el, row, state);
        if (state.showErrors) paint(el, row, state);
      });
    }

    function paintErrors() {
      Array.prototype.forEach.call(listEl.children, function (el) {
        var row = state.rows.filter(function (r) { return r.id === el.dataset.id; })[0];
        if (row) paint(el, row, state);
      });
    }

    return {
      renderAll: renderAll,
      syncAll: syncAll,
      paintErrors: paintErrors
    };
  }

  NS.ui = NS.ui || {};
  NS.ui.skuRows = { mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
