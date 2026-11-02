/*
 * 结果面板：校验错误清单 / 参数汇总指标。
 * M2 会在这里接装载率、分层明细；本版只汇总输入。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  var S = NS.shapes;

  function m3(mm3) {
    return (mm3 / 1e9).toFixed(3);
  }

  function kg(n) {
    return (Math.round(n * 10) / 10).toLocaleString('zh-CN');
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderErrors(res, state) {
    var html = '<div class="err-summary">';
    if (state.rows.length === 0) {
      html += '<p class="err-line">还没有添加箱型，请先点「+ 添加箱型」。</p>';
    }
    if (res.containerErrors.filter(function (e) { return e.level === 'error'; }).length) {
      html += '<div class="err-group"><h3>集装箱参数</h3><ul>';
      res.containerErrors.forEach(function (e) {
        if (e.level !== 'error') return;
        html += '<li>' + esc(e.message) + '</li>';
      });
      html += '</ul></div>';
    }
    state.rows.forEach(function (row, i) {
      var errs = (res.rowErrors[row.id] || []).filter(function (e) { return e.level === 'error'; });
      if (!errs.length) return;
      var shape = S.get(row.shape);
      html += '<div class="err-group"><h3>第 ' + (i + 1) + ' 行 · ' + shape.name +
        (row.name ? '（' + esc(row.name) + '）' : '') + '</h3><ul>';
      errs.forEach(function (e) {
        html += '<li>' + esc(e.message) + '</li>';
      });
      html += '</ul></div>';
    });
    html += '</div>';
    return html;
  }

  function renderOk(res) {
    var t = res.totals;
    var hasWeight = t.hasAllWeight;
    var weightValue = hasWeight ? kg(t.weight) : '—';
    var weightSub = hasWeight ? 'kg（按单箱重 × 数量）' : '有箱型未填单箱重，无法判断超载';

    var html = '<div class="metrics">' +
      '<div class="metric"><span class="metric-label">箱型 / 总箱数</span>' +
        '<span class="metric-value">' + t.skuCount + ' 种 / ' + t.qty.toLocaleString('zh-CN') + ' 箱</span></div>' +
      '<div class="metric"><span class="metric-label">净体积合计</span>' +
        '<span class="metric-value">' + m3(t.netVolume) + ' <small>m³</small></span>' +
        '<span class="metric-sub">外接体积 ' + m3(t.outerVolume) + ' m³（排布口径）</span></div>' +
      '<div class="metric"><span class="metric-label">总重量</span>' +
        '<span class="metric-value">' + weightValue + (hasWeight ? ' <small>kg</small>' : '') + '</span>' +
        '<span class="metric-sub">' + weightSub + '</span></div>' +
      '<div class="metric ok"><span class="metric-label">参数校验</span>' +
        '<span class="metric-value">通过</span>' +
        '<span class="metric-sub">可以进入排布计算</span></div>' +
      '</div>';

    html += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>#</th><th>箱型</th><th>名称</th><th>外接尺寸 (mm)</th><th>净体积/箱 (m³)</th>' +
      '<th>数量</th><th>净体积合计 (m³)</th><th>重量 (kg)</th>' +
      '</tr></thead><tbody>';

    res.rows.forEach(function (r, i) {
      var s = r.summary;
      html += '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(s.shapeName) + '</td>' +
        '<td>' + (r.name ? esc(r.name) : '<span class="muted">—</span>') + '</td>' +
        '<td class="mono">' + S.num(s.bbox.l) + ' × ' + S.num(s.bbox.w) + ' × ' + S.num(s.bbox.h) + '</td>' +
        '<td class="num mono">' + m3(s.netVolume) + '</td>' +
        '<td class="num mono">' + s.qty.toLocaleString('zh-CN') + '</td>' +
        '<td class="num mono">' + m3(s.netTotal) + '</td>' +
        '<td class="num mono">' + (s.totalWeight === null ? '<span class="muted">—</span>' : kg(s.totalWeight)) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    var warns = [];
    if (!res.totals.hasAllWeight) warns.push('有箱型没填单箱重量，M2 无法判断是否超载。');
    if (warns.length) {
      html += '<div class="warn-box">' + warns.map(function (w) { return '<p>' + esc(w) + '</p>'; }).join('') + '</div>';
    }

    html += '<div class="next-note">M1 阶段只做参数校验与体积汇总。分层排布、体积装载率、分层明细在 M2 接入；3D 装柜图在 M3 接入。</div>';
    return html;
  }

  function render(res, state) {
    var card = document.getElementById('result-card');
    var title = document.getElementById('result-title');
    var hint = document.getElementById('result-hint');
    var body = document.getElementById('result-body');

    card.classList.remove('hidden', 'is-error', 'is-ok');
    card.classList.add(res.ok ? 'is-ok' : 'is-error');
    title.textContent = res.ok ? '参数校验通过' : '校验未通过';
    hint.textContent = res.ok
      ? '可以进入排布计算'
      : '共 ' + res.errorCount + ' 处需要修改，已在清单中标红';

    body.innerHTML = res.ok ? renderOk(res) : renderErrors(res, state);
  }

  function markStale() {
    var hint = document.getElementById('result-hint');
    var card = document.getElementById('result-card');
    if (!card || card.classList.contains('hidden')) return;
    hint.textContent = '参数已修改，请重新计算';
  }

  NS.ui = NS.ui || {};
  NS.ui.result = { render: render, markStale: markStale };
})(typeof globalThis !== 'undefined' ? globalThis : this);
