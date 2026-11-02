/*
 * 结果面板：校验错误清单 / 装柜指标 / 每 SKU 装载情况 / 分层明细。
 * 装柜数据来自 js/core/pack.js。
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

  function pct(x) {
    return (Math.round(x * 1000) / 10).toFixed(1) + '%';
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function nameOf(item) {
    return item.name ? item.name : item.shapeName + ' #' + (item.index + 1);
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

  function renderPack(res, pack, state) {
    var t = pack.totals;
    var c = pack.container;
    var allLoaded = t.remainingCount === 0;

    var html = '<div class="metrics">' +
      '<div class="metric"><span class="metric-label">体积装载率</span>' +
        '<span class="metric-value">' + pct(t.fillRate) + '</span>' +
        '<span class="metric-sub">净体积 ' + m3(t.netVolume) + ' / 柜内 ' + m3(pack.containerVolume) + ' m³</span></div>' +
      '<div class="metric"><span class="metric-label">已装箱数</span>' +
        '<span class="metric-value">' + t.loadedCount.toLocaleString('zh-CN') + ' <small>/ ' + t.requestedCount.toLocaleString('zh-CN') + ' 箱</small></span>' +
        '<span class="metric-sub">' + (allLoaded ? '全部装完' : '剩余 ' + t.remainingCount.toLocaleString('zh-CN') + ' 箱未装') + '</span></div>' +
      '<div class="metric"><span class="metric-label">总重 / 载重上限</span>' +
        '<span class="metric-value">' + (t.weightKnown ? kg(t.weight) : '—') +
          (t.weightKnown ? ' <small>/ ' + kg(t.payload) + ' kg</small>' : '') + '</span>' +
        '<span class="metric-sub">' + (t.weightKnown
          ? '载重利用率 ' + pct(t.payload > 0 ? t.weight / t.payload : 0) + (t.overloaded ? ' · 货物总重超载' : ' · 未超载')
          : '有箱型未填单箱重，载重未校验') + '</span></div>' +
      '<div class="metric"><span class="metric-label">层数 / 用高</span>' +
        '<span class="metric-value">' + t.layerCount + ' <small>层</small></span>' +
        '<span class="metric-sub">用高 ' + S.num(pack.usedHeight) + ' / ' + S.num(c.innerH) + ' mm（' + pct(t.heightUsage) + '）</span></div>' +
      '</div>';

    // 未装完的必须说清原因
    if (!allLoaded) {
      html += '<div class="warn-box"><p class="warn-title">未装完：' + t.remainingCount + ' 箱（' +
        m3(pack.items.reduce(function (s, it) { return s + it.remaining * it.netVolumeEach; }, 0)) + ' m³）</p><ul>';
      pack.items.forEach(function (it) {
        if (it.remaining <= 0) return;
        html += '<li><b>' + esc(nameOf(it)) + '</b>（' + it.shapeName + '）剩 ' + it.remaining + ' 箱 — ' +
          esc(it.reason ? it.reason.message : '未能装入') + '</li>';
      });
      html += '</ul></div>';
    }

    if (t.overloaded) {
      html += '<div class="warn-box"><p>货物总重 ' + kg(t.requestedWeight) + ' kg 超过 ' +
        kg(t.payload) + ' kg 上限，已按载重截断。</p></div>';
    }

    // 每 SKU
    html += '<h3 class="block-title">每个箱型的装载结果</h3>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>#</th><th>箱型</th><th>名称</th><th>外接尺寸 (mm)</th><th>需求</th><th>已装</th><th>剩余</th><th>净体积 (m³)</th><th>说明</th>' +
      '</tr></thead><tbody>';
    pack.items.forEach(function (it, i) {
      var note = it.remaining > 0
        ? '<span class="bad">' + esc(it.reason ? it.reason.message : '未装入') + '</span>'
        : '<span class="good">已全部装入</span>';
      html += '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(it.shapeName) + '</td>' +
        '<td>' + esc(nameOf(it)) + '</td>' +
        '<td class="mono">' + S.num(it.bbox.l) + ' × ' + S.num(it.bbox.w) + ' × ' + S.num(it.bbox.h) + '</td>' +
        '<td class="num mono">' + it.qty.toLocaleString('zh-CN') + '</td>' +
        '<td class="num mono"><b>' + it.loaded.toLocaleString('zh-CN') + '</b></td>' +
        '<td class="num mono">' + (it.remaining > 0 ? '<span class="bad">' + it.remaining + '</span>' : '0') + '</td>' +
        '<td class="num mono">' + m3(it.loaded * it.netVolumeEach) + '</td>' +
        '<td class="note-cell">' + note + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    // 分层
    html += '<h3 class="block-title">分层明细 <span class="muted">（自下而上，层号 1 在最底层）</span></h3>' +
      '<div class="table-wrap tall"><table class="tbl"><thead><tr>' +
      '<th>层</th><th>箱型</th><th>名称</th><th>本层箱数</th><th>单层容量</th><th>层高 (mm)</th><th>层顶高度 (mm)</th><th>朝向</th>' +
      '</tr></thead><tbody>';
    pack.layers.forEach(function (L) {
      var item = null;
      pack.items.forEach(function (it) { if (it.id === L.skuId) item = it; });
      html += '<tr>' +
        '<td class="num">' + (L.index + 1) + '</td>' +
        '<td>' + esc(L.shapeName) + '</td>' +
        '<td>' + esc(item ? nameOf(item) : (L.skuName || '—')) + '</td>' +
        '<td class="num mono">' + L.count + '</td>' +
        '<td class="num mono">' + L.capacity + '</td>' +
        '<td class="num mono">' + S.num(L.height) + '</td>' +
        '<td class="num mono">' + S.num(L.top) + '</td>' +
        '<td>' + (L.rot === 90 ? '旋转 90°' : '不旋转') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="next-note">' +
      '停止原因：' + esc(pack.stop.message) + '。' +
      '排布按外接长方体占位；L形箱/斜顶箱的 3D 几何按真实形状渲染（M3）。' +
      (pack.truncated ? ' 本次结果已截断。' : '') +
      '</div>';
    return html;
  }

  function render(res, pack, state) {
    var card = document.getElementById('result-card');
    var title = document.getElementById('result-title');
    var hint = document.getElementById('result-hint');
    var body = document.getElementById('result-body');

    card.classList.remove('hidden', 'is-error', 'is-ok', 'is-partial');
    if (!res.ok) {
      card.classList.add('is-error');
      title.textContent = '校验未通过';
      hint.textContent = '共 ' + res.errorCount + ' 处需要修改，已在清单中标红';
      body.innerHTML = renderErrors(res, state);
      return;
    }

    card.classList.add(pack.totals.remainingCount === 0 ? 'is-ok' : 'is-partial');
    title.textContent = pack.totals.remainingCount === 0 ? '装载方案' : '部分装载';
    hint.textContent = pack.totals.remainingCount === 0
      ? '全部 ' + pack.totals.loadedCount.toLocaleString('zh-CN') + ' 箱已装入'
      : '还有 ' + pack.totals.remainingCount.toLocaleString('zh-CN') + ' 箱装不下';
    body.innerHTML = renderPack(res, pack, state);
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
