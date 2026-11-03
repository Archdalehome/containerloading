/*
 * 「复制诊断」：把这一单的关键信息拼成一段纯文本，用户粘贴过来我们就能直接定位。
 * 只放事实（柜型、SKU、开关、结果、为什么停、体检四项），不放推测。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  var S = NS.shapes;

  function num(n) {
    return S && S.num ? S.num(n) : String(n);
  }

  function shapeText(it) {
    var sv = it.shapeValues || {};
    if (it.shape === 'lshape') {
      return 'L形 L' + num(sv.l) + '×W' + num(sv.w) + '×H' + num(sv.h) +
        '（W低' + num(sv.wlow) + '/W高' + num(sv.whigh) + '，H低' + num(sv.hlow) + '/H高' + num(sv.hhigh) + '）';
    }
    if (it.shape === 'slope') {
      return '斜顶 L' + num(sv.l) + '×W' + num(sv.w) + '×H' + num(sv.h) +
        '（H底' + num(sv.hlow) + '/H高' + num(sv.hhigh) + '）';
    }
    return '矩形 ' + num(sv.l) + '×' + num(sv.w) + '×' + num(sv.h);
  }

  /** 拼诊断文本；pack 为空时只给柜型和输入 */
  function buildText(pack, state) {
    var lines = [];
    var c = (pack && pack.container) || (state && state.container) || {};
    lines.push('【装柜计算器 · 诊断信息】');
    lines.push('柜型：' + (c.key || '—') + ' 内长 ' + num(c.innerL) + ' / 内宽 ' + num(c.innerW) +
      ' / 内高 ' + num(c.innerH) + ' / 门高 ' + num(c.doorH) + ' / 载重 ' + num(c.payload) + ' kg');

    var rowsById = {};
    ((state && state.rows) || []).forEach(function (r) { rowsById[r.id] = r; });

    lines.push('输入箱型：');
    var items = (pack && pack.items) || [];
    if (!items.length) {
      ((state && state.rows) || []).forEach(function (r, i) {
        var shape = NS.shapes.get(r.shape);
        lines.push('  ' + (i + 1) + ') ' + (r.name || shape.name) + ' ' +
          shape.fields.map(function (f) { return f.key + ' ' + (r.values || {})[f.key]; }).join(' ') +
          '，数量 ' + r.qty + '，单箱重 ' + (r.weight || '未填'));
      });
    } else {
      items.forEach(function (it, i) {
        var r = rowsById[it.id] || {};
        lines.push('  ' + (i + 1) + ') ' + shapeText(it) +
          '，需求 ' + it.qty + '，已装 ' + it.loaded + '，剩余 ' + it.remaining +
          '，单箱重 ' + (it.unitWeight === null || it.unitWeight === undefined ? '未填' : num(it.unitWeight)) + ' kg' +
          '，允许侧放 ' + (r.allowSide === false ? '关' : '开') +
          '，允许倒放 ' + (r.allowFlip === false ? '关' : '开'));
      });
    }

    var opts = (state && state.options) || {};
    lines.push('开关：跨 SKU 填缝 ' + (opts.allowFill ? '开' : '关') +
      ' / 垫块填缺口 ' + (opts.allowDunnage ? '开' : '关'));

    if (pack) {
      var t = pack.totals || {};
      lines.push('结果：已装 ' + t.loadedCount + ' / ' + t.requestedCount + ' 箱，装载率 ' +
        (Math.round((t.fillRate || 0) * 1000) / 10) + '%，净体积 ' +
        (Math.round((t.netVolume || 0) / 1e6) / 1000) + ' m³，层数 ' + t.layerCount +
        '，用高 ' + num(pack.usedHeight) + ' mm');
      if (pack.planSet) {
        lines.push('方案：已比较 ' + pack.planSet.compared + ' 个，零前提最优 ' +
          (pack.planSet.best ? pack.planSet.best.boxes : 0) + ' 箱');
      }
      if (NS.explain) {
        var why = NS.explain.stopText(pack);
        lines.push('为什么停：' + (why.base || '未停止') +
          (why.items.length ? '；' + why.items.map(function (m) { return m.name + ' 剩 ' + m.remaining + ' 箱（' + m.why + '）'; }).join('；') : ''));
        if (t.remainingCount === 0 || t.remainingCount > 0) {
          var sp = NS.explain.space(pack);
          lines.push('空间：剩余 ' + (Math.round(sp.remaining / 1e6) / 1000) + ' m³ = 可承重 ' +
            (Math.round(sp.bearing / 1e6) / 1000) + ' + 不可承重 ' + (Math.round(sp.nonBearing / 1e6) / 1000) +
            '（斜面 ' + (Math.round(sp.slopeTop / 1e6) / 1000) + ' / 顶面零碎 ' +
            (Math.round(sp.fragment / 1e6) / 1000) + ' / 高度不足 ' + (Math.round(sp.heightShort / 1e6) / 1000) + '）');
        }
      }
      if (NS.ui && NS.ui.health) {
        try {
          var h = NS.ui.health.inspect(pack);
          lines.push('体检：越界 ' + h.badRender + ' 箱 / 重叠 ' + h.overlaps.length + ' 对 / 悬空 ' +
            h.floating.length + ' 箱 / 渲染与占位最大偏差 ' + (Math.round(h.maxErr * 10) / 10) + ' mm');
        } catch (e) {
          lines.push('体检：读不到（' + (e && e.message) + '）');
        }
      }
    } else {
      lines.push('结果：未计算（校验未通过或还没点计算）');
    }
    lines.push('（把这段整段发回来即可，不用再描述参数）');
    return lines.join('\n');
  }

  var lastText = '';

  function feedback(ok) {
    var el = document.querySelector('#result-body .diag-tip');
    if (!el) return;
    el.textContent = ok ? '已复制到剪贴板' : '复制失败，请手动选中';
    el.classList.add(ok ? 'ok' : 'bad');
    setTimeout(function () {
      if (el) { el.textContent = ''; el.classList.remove('ok', 'bad'); }
    }, 2500);
  }

  function copy(pack, state) {
    var text = buildText(pack, state);
    lastText = text;
    var done = function (ok) { feedback(ok); };
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return text;
    }
    // 老浏览器兜底
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) {
      done(false);
    }
    return text;
  }

  NS.ui = NS.ui || {};
  NS.ui.diag = {
    buildText: buildText,
    copy: copy,
    last: function () { return lastText; }
  };

  // 按钮在结果区里，用事件委托，避免每次重渲染后重新绑定
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest('#diag-btn')) return;
    copy(NS.app && NS.app.lastPack, (NS.app && NS.app.lastState) || { container: {}, rows: [] });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
