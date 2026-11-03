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

  /**
   * 「为什么停」：装载率旁边的解释。
   *   1. 停在哪、因为哪条物理规则
   *   2. 剩余空间拆成可承重 / 不可承重（斜面、顶面零碎、高度不足）
   *   3. 每条阻塞原因后面挂解锁方式（真跑一遍给的数，不估）
   */
  function renderWhy(pack, state) {
    var X = NS.explain;
    if (!X) return '';
    var t = pack.totals;

    // 全部装完：这就不是「装不进去」，而是货量本身只有这么多，必须说清楚，否则用户会以为算错
    if (t.remainingCount === 0) {
      var sp0 = X.space(pack);
      var hr = X.headroom ? X.headroom(state, pack, pack.planSet) : null;
      var html0 = '<div class="why-box is-done">';
      html0 += '<p class="why-title">全部 <b>' + t.loadedCount.toLocaleString('zh-CN') +
        '</b> 箱已装入本柜' +
        (hr && hr.moreBoxes > 0 ? ' · 柜内还能再放约 <b>' + hr.moreBoxes.toLocaleString('zh-CN') + ' 箱</b>' : '') +
        ' · 装载率 <b>' + pct(t.fillRate) + '</b>（货量上限，非算法限制）</p>';
      html0 += '<p class="why-line">装载率低是因为这批货的净体积只有 ' + m3(t.netVolume) +
        ' m³，柜子装满了也到不了 100%——不是算法卡住，也不是装不下。</p>';
      html0 += '<p class="why-line">柜内还有 <b>' + m3(sp0.remaining) + ' m³</b> 空位' +
        (hr ? '；按同一套规则，本柜上限 <b>' + hr.capacity.toLocaleString('zh-CN') + ' 箱</b>' +
          (hr.moreBoxes > 0 ? '（还能再装 ' + hr.moreBoxes.toLocaleString('zh-CN') + ' 箱，约 ' +
            m3(hr.moreVolume) + ' m³）' : '，已经装满') : '') + '。</p>';
      html0 += '</div>';
      return html0;
    }

    var why = X.stopText(pack);
    var sp = X.space(pack);
    var unlocks = X.unlocks(state, pack, pack.planSet);

    var html = '<div class="why-box">';
    html += '<p class="why-title">为什么停在这里：<b>' + esc(why.base) + '</b></p>';

    html += '<p class="why-line">剩余空间 <b>' + m3(sp.remaining) + ' m³</b> = ' +
      '可承重 <b>' + m3(sp.bearing) + ' m³</b>（顶面是平的，还放得下） + ' +
      '不可承重 <b>' + m3(sp.nonBearing) + ' m³</b>（斜面 ' + m3(sp.slopeTop) +
      ' · 顶面零碎 ' + m3(sp.fragment) + ' · 高度不足 ' + m3(sp.heightShort) + '）</p>';

    if (sp.bearing > 1e9) {
      html += '<p class="why-line muted">可承重那部分没被用上，是因为当前<b>一层只排一个主箱型</b>' +
        '（同层换姿态填条带才刚加上），不是物理限制。</p>';
    }

    why.items.forEach(function (m) {
      html += '<p class="why-line">· <b>' + esc(m.name) + '</b> 剩 ' + m.remaining.toLocaleString('zh-CN') +
        ' 箱 — ' + esc(m.why) + '</p>';
    });

    if (unlocks.length) {
      html += '<p class="why-unlock">想再装：' + unlocks.map(function (u) {
        return '<span class="why-chip' + (u.gated ? ' gated' : '') + '">' + esc(u.label) +
          ' → <b>' + u.boxes.toLocaleString('zh-CN') + ' 箱</b>（+' + u.delta + '）<small>' + esc(u.note) + '</small></span>';
      }).join('') + '</p>';
      html += '<p class="why-hint">默认不限方向；要限制的货（有「此面向上」标识、易碎必须立放的），' +
        '在那一行取消「允许侧放 / 允许倒放」即可。</p>';
    }
    html += '</div>';
    return html;
  }

  function renderPack(res, pack, state) {
    var t = pack.totals;
    var c = pack.container;
    var extra = pack.extra || null;
    var allLoaded = t.remainingCount === 0;
    var totalContainers = 1 + (extra ? extra.count : 0);

    var dunnageVol = (pack.dunnage || []).reduce(function (s, b) { return s + b.l * b.w * b.h; }, 0);
    var spaceWithDunnage = pack.containerVolume > 0 ? (t.netVolume + dunnageVol) / pack.containerVolume : 0;

    var html = '';

    // 空结果也要有话说：0 箱、方案全不合法、没有可得结论，都不能只留一片空白
    if (pack.planSet && pack.planSet.ranked && pack.planSet.ranked.length === 0) {
      var firstErr = pack.planSet.plans[0] && pack.planSet.plans[0].errors && pack.planSet.plans[0].errors[0];
      html += '<div class="warn-box"><p class="warn-title">' + pack.planSet.plans.length +
        ' 个方案全部未通过物理校验</p>' +
        '<p class="extra-line">这不该发生——说明排布或校验有 bug。请把这单参数发我，第一个错误：' +
        esc(firstErr ? firstErr.message : '未知错误') + '</p></div>';
    }
    if (t.loadedCount === 0) {
      html += '<div class="warn-box"><p class="warn-title">这单一个箱子都没装进去</p>' +
        '<p class="extra-line">停止原因：' + esc(pack.stop ? pack.stop.message : '未说明') +
        '。逐行的叠放诊断和说明在下面两张表里。</p></div>';
    }

    // 方案对比条：全部方案的箱数都列出来，前 3 名可切 3D
    if (pack.planSet) {
      var ps = pack.planSet;
      var sortedPlans = ps.plans.slice().sort(function (a, b) {
        if (b.boxes !== a.boxes) return b.boxes - a.boxes;
        return a.cog.lateral - b.cog.lateral;
      });
      html += '<div class="plans"><p class="plans-title">已比较 <b>' + ps.compared + '</b> 种方案，' +
        '零前提最优 <b>' + (ps.best ? ps.best.boxes : 0) + '</b> 箱' +
        (ps.best ? '（' + esc(ps.best.config.label) + '）' : '') + '</p>';
      if (ps.bestGated && (!ps.best || ps.bestGated.boxes > ps.best.boxes)) {
        html += '<p class="plans-gated">若自备 <b>' + ps.bestGated.dunnageBlocks +
          '</b> 块垫块，可到 <b>' + ps.bestGated.boxes +
          '</b> 箱（非货品，需自行准备；勾选「用垫块填平 L 形缺口」后才参与最优评选）。</p>';
      }
      html += '<div class="plan-list">';
      sortedPlans.forEach(function (p, idx) {
        var cls = 'plan-chip' + (idx < 3 ? ' top' : '') + (p.valid ? '' : ' invalid') +
          (p.gated ? ' gated' : '') + (pack === p.pack ? ' active' : '');
        var extra = p.gated ? ' · 需 ' + p.dunnageBlocks + ' 块垫块' : '';
        html += '<button type="button" class="' + cls + '" data-plan="' + p.config.id + '" title="' +
          esc(p.config.label + (p.gated ? '（需自行准备垫块）' : '')) + '">#' + p.config.id + ' ' +
          p.boxes + ' 箱' + (p.valid ? '' : ' ✗') + extra + '</button>';
      });
      html += '</div><p class="plans-sub">按箱数排名：箱数 → 重心横向偏移 → 净体积；只有合法排布参与排名。方案条前 3 名可点击切换 3D；带「需 N 块垫块」的方案要先准备垫块或配箱。</p></div>';
    }

    html += '<div class="metrics">' +
      '<div class="metric"><span class="metric-label">体积装载率</span>' +
        '<span class="metric-value">' + pct(t.fillRate) + '</span>' +
        '<span class="metric-sub">净体积 ' + m3(t.netVolume) + ' / 柜内 ' + m3(pack.containerVolume) + ' m³' +
          (dunnageVol > 0 ? ' · 含垫块占用 ' + pct(spaceWithDunnage) + '（垫块 ' + m3(dunnageVol) + ' m³，非货品）' : '') +
        '</span></div>' +
      '<div class="metric"><span class="metric-label">已装箱数</span>' +
        '<span class="metric-value">' + t.loadedCount.toLocaleString('zh-CN') + ' <small>/ ' + t.requestedCount.toLocaleString('zh-CN') + ' 箱</small></span>' +
        '<span class="metric-sub">' + (allLoaded
          ? '全部 ' + t.loadedCount.toLocaleString('zh-CN') + ' 箱已装入 · 柜内空位 ' +
            m3(Math.max(0, pack.containerVolume - t.netVolume - dunnageVol)) + ' m³'
          : '剩余 ' + t.remainingCount.toLocaleString('zh-CN') + ' 箱未装') + '</span></div>' +
      '<div class="metric"><span class="metric-label">总重 / 载重上限</span>' +
        '<span class="metric-value">' + (t.weightKnown ? kg(t.weight) : '—') +
          (t.weightKnown ? ' <small>/ ' + kg(t.payload) + ' kg</small>' : '') + '</span>' +
        '<span class="metric-sub">' + (t.weightKnown
          ? '载重利用率 ' + pct(t.payload > 0 ? t.weight / t.payload : 0) + (t.overloaded ? ' · 货物总重超载' : ' · 未超载')
          : '有箱型未填单箱重，载重未校验') + '</span></div>' +
      '<div class="metric"><span class="metric-label">层数 / 用高</span>' +
        '<span class="metric-value">' + t.layerCount + ' <small>层</small></span>' +
        '<span class="metric-sub">用高 ' + S.num(pack.usedHeight) + ' / ' + S.num(c.innerH) + ' mm（' + pct(t.heightUsage) + '）</span></div>' +
      '<div class="metric' + (allLoaded ? ' ok' : '') + '"><span class="metric-label">所需柜数</span>' +
        '<span class="metric-value">' + totalContainers + ' <small>个 ' + esc(c.key) + '</small></span>' +
        '<span class="metric-sub">' + (allLoaded
          ? '全部装进本柜'
          : '本柜装 ' + t.loadedCount.toLocaleString('zh-CN') + ' 箱，剩余需 ' + (extra ? extra.count : '?') + ' 个') + '</span></div>' +
      '</div>';

    html += renderWhy(pack, state);

    // 配套箱建议：L 形台阶缺口填平后能多装多少（分「有配套件」和「用垫块」两种情况）
    if (pack.suggestions && pack.suggestions.length) {
      html += '<div class="advice">';
      pack.suggestions.forEach(function (s) {
        var f = s.filler;
        var dims = S.num(f.l) + '×' + S.num(f.w) + '×' + S.num(f.h);
        html += '<p class="advice-title">缺口尺寸 ' + dims + '：填平后 ' + esc(s.name) +
          ' 能从 ' + s.before + ' 箱装到 <b>' + s.after + '</b> 箱（多 ' + s.delta + ' 箱）</p>';
        html += '<ul class="advice-list">' +
          '<li><b>手里有配套件</b>：加 ' + s.fillerQty + ' 个 ' + dims + ' 的配套箱，' +
          'L 形装 ' + s.after + ' 箱、配套件 ' + s.fillerQty + ' 箱，合计 ' +
          (s.after + s.fillerQty) + ' 箱；等价于多发 ' + s.fillerQty + ' 箱货。</li>' +
          '<li><b>没有配套件</b>：用 ' + dims + ' 的垫块 / 纸板把缺口垫平，L 形同样能装到 ' + s.after +
          ' 箱，装载量和有配套件时一样，但不多发货，垫块回收或计入包装即可。</li>' +
          '</ul>';
      });
      html += '<p class="advice-sub">两种情况能装的 L 箱数相同，区别只在「要不要多发一款货」。台阶缺口填平后这一层顶面才是完整水平面，才能继续往上叠。</p></div>';
    }

    // 未装完的必须说清原因，并给出补柜数量
    if (!allLoaded) {
      html += '<div class="warn-box"><p class="warn-title">未装完：' + t.remainingCount + ' 箱（' +
        m3(pack.items.reduce(function (s, it) { return s + it.remaining * it.netVolumeEach; }, 0)) + ' m³）</p><ul>';
      pack.items.forEach(function (it) {
        if (it.remaining <= 0) return;
        html += '<li><b>' + esc(nameOf(it)) + '</b>（' + it.shapeName + '）剩 ' + it.remaining + ' 箱 — ' +
          esc(it.reason ? it.reason.message : '未能装入') + '</li>';
      });
      html += '</ul>';
      if (extra) {
        if (extra.count > 0) {
          html += '<div class="extra-box"><p class="extra-line">按同规格 <b>' + esc(extra.containerKey) +
            '</b> 估算：剩余货物还需 <b>' + extra.count + ' 个柜</b>' +
            (extra.truncated ? '（已超过 50 个，仅估算到此）' : '') +
            '。分柜策略是「装满即走，剩下再开一柜」，不按箱数平均分摊。</p>';
          html += '<div class="table-wrap"><table class="tbl mini"><thead><tr>' +
            '<th>柜序</th><th>箱数</th><th>净体积 (m³)</th><th>体积装载率</th><th>重量 (kg)</th></tr></thead><tbody>';
          html += '<tr><td>本柜</td><td class="num mono">' + t.loadedCount.toLocaleString('zh-CN') + '</td>' +
            '<td class="num mono">' + m3(t.netVolume) + '</td><td class="num mono">' + pct(t.fillRate) + '</td>' +
            '<td class="num mono">' + (t.weightKnown ? kg(t.weight) : '—') + '</td></tr>';
          extra.rounds.forEach(function (r, i) {
            var rate = r.fillRate;
            html += '<tr><td>第 ' + (i + 2) + ' 柜</td><td class="num mono">' + r.loaded.toLocaleString('zh-CN') + '</td>' +
              '<td class="num mono">' + m3(r.netVolume) + '</td>' +
              '<td class="num mono' + (rate < 0.2 ? ' low-fill' : '') + '">' + pct(rate) + '</td>' +
              '<td class="num mono">' + (r.weightKnown ? kg(r.weight) : '—') + '</td></tr>';
          });
          html += '</tbody></table></div>';
          var last = extra.rounds[extra.rounds.length - 1];
          if (last && last.fillRate < 0.2) {
            html += '<p class="extra-line">注意：最后第 ' + (extra.rounds.length + 1) + ' 个柜只装了 ' +
              last.loaded + ' 箱（' + pct(last.fillRate) + '），可以考虑并柜或调整订单。</p>';
          }
          html += '</div>';
        }
        if (extra.impossibleCount > 0) {
          html += '<p class="extra-line">另有 <b>' + extra.impossibleCount + ' 箱</b>（' +
            extra.impossibleNames.map(esc).join('、') + '）超过门高或底面超尺寸，换同规格柜也装不进，需要改箱型或换柜型。</p>';
        }
        // 补柜算出 0 个但还有剩余：不能只留一句「还需 0 个」，得说清为什么开新柜也没用
        if (extra.count === 0 && extra.impossibleCount === 0) {
          html += '<p class="extra-line">按同规格柜再算，<b>剩余 ' + t.remainingCount +
            ' 箱一个新柜也装不进</b>——尺寸和重量都过得了门槛，但在这个柜型里排不下（原因见上）。' +
            '换更大的柜型、或把这类箱子拆小后再试。</p>';
        }
      } else if (t.remainingCount > 0) {
        html += '<p class="extra-line">剩余 ' + t.remainingCount + ' 箱没有做补柜估算（缺少柜型参数），换柜前请先确认集装箱规格。</p>';
      }
      html += '</div>';
    }

    if (t.overloaded) {
      html += '<div class="warn-box"><p>货物总重 ' + kg(t.requestedWeight) + ' kg 超过 ' +
        kg(t.payload) + ' kg 上限，已按载重截断。</p></div>';
    }

    // 每 SKU
    html += '<h3 class="block-title">每个箱型的装载结果</h3>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>#</th><th>箱型</th><th>名称</th><th>外接尺寸 (mm)</th><th>需求</th><th>已装</th><th>剩余</th><th>净体积 (m³)</th><th>叠放诊断</th><th>说明</th>' +
      '</tr></thead><tbody>';
    pack.items.forEach(function (it, i) {
      var note = it.remaining > 0
        ? '<span class="bad">' + esc(it.reason ? it.reason.message : '未装入') + '</span>'
        : '<span class="good">已全部装入</span>';
      var stackMsg = it.stack
        ? (it.stack.code === 'ok'
          ? '<span class="good">可叠放</span>'
          : '<span class="' + (it.stack.code === 'pair-ok' ? 'good' : 'bad') + '">' + esc(it.stack.message) + '</span>')
        : '—';
      html += '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(it.shapeName) + '</td>' +
        '<td>' + esc(nameOf(it)) + '</td>' +
        '<td class="mono">' + S.num(it.bbox.l) + ' × ' + S.num(it.bbox.w) + ' × ' + S.num(it.bbox.h) + '</td>' +
        '<td class="num mono">' + it.qty.toLocaleString('zh-CN') + '</td>' +
        '<td class="num mono"><b>' + it.loaded.toLocaleString('zh-CN') + '</b></td>' +
        '<td class="num mono">' + (it.remaining > 0 ? '<span class="bad">' + it.remaining + '</span>' : '0') + '</td>' +
        '<td class="num mono">' + m3(it.loaded * it.netVolumeEach) + '</td>' +
        '<td class="note-cell">' + stackMsg + '</td>' +
        '<td class="note-cell">' + note + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    // 分层
    html += '<h3 class="block-title">分层明细 <span class="muted">（自下而上，层号 1 在最底层）</span></h3>' +
      '<div class="table-wrap tall"><table class="tbl"><thead><tr>' +
      '<th>层</th><th>箱型</th><th>名称</th><th>本层箱数</th><th>其中主姿态 / 换姿态填条带</th><th>单层容量</th><th>层高 (mm)</th><th>层顶高度 (mm)</th><th>姿态</th><th>本层填缝</th>' +
      '</tr></thead><tbody>';
    pack.layers.forEach(function (L) {
      var item = null;
      pack.items.forEach(function (it) { if (it.id === L.skuId) item = it; });
      var poseLabel = L.kind === 'pair' ? '对扣（一正一倒）'
        : L.kind === 'side' ? '侧放'
          : L.kind === 'flip' ? '倒放' : '正放';
      var fillText = (L.fill && L.fill.length)
        ? L.fill.map(function (f) { return (f.name || '填缝箱') + ' ' + f.count + ' 箱'; }).join('、')
        : '—';
      if (L.dunnage > 0) {
        fillText = (fillText === '—' ? '' : fillText + '；') + '垫块 ' + L.dunnage + ' 块（非货品）';
      }
      html += '<tr>' +
        '<td class="num">' + (L.index + 1) + '</td>' +
        '<td>' + esc(L.shapeName) + '</td>' +
        '<td>' + esc(item ? nameOf(item) : (L.skuName || '—')) + '</td>' +
        '<td class="num mono">' + L.count + '</td>' +
        '<td class="num mono">' + (L.mainCount !== undefined ? L.mainCount : L.count) +
          ' / ' + (L.stripCount || 0) + '</td>' +
        '<td class="num mono">' + L.capacity + '</td>' +
        '<td class="num mono">' + S.num(L.height) + '</td>' +
        '<td class="num mono">' + S.num(L.top) + '</td>' +
        '<td>' + poseLabel + '</td>' +
        '<td class="note-cell">' + esc(fillText) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="next-note">' +
      '停止原因：' + esc(pack.stop.message) + '。' +
      '排布按外接长方体占位；L形箱/斜顶箱的 3D 几何按真实形状渲染（M3）。' +
      (pack.truncated ? ' 本次结果已截断。' : '') +
      '</div>';

    // 本单体检：由 js/ui/health.js 在 3D 建好之后填（这里只留挂载点）
    html += '<div id="health-box" class="health"></div>';
    return html;
  }

  function render(res, pack, state) {
    var card = document.getElementById('result-card');
    var title = document.getElementById('result-title');
    var hint = document.getElementById('result-hint');
    var body = document.getElementById('result-body');
    var exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.hidden = !res.ok;

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
