/*
 * 「为什么停」解释：把装载率旁边的空间和停止原因说清楚。
 *
 * 三件事：
 *   1. stopText(pack)   为什么停——直接说物理原因，不让用户自己猜
 *   2. space(pack)      剩余空间拆成「可承重（还能放）」和「不可承重（斜面 / 高度不足）」
 *   3. unlocks(pack, planSet)  同一策略下，勾某个开关能多装多少（真跑一遍，不是估）
 *
 * 空间口径（可复算，写在这里备查）：
 *   把柜底切成 50mm 网格，逐格算「这一列最高的实体顶面」：
 *     已用体积 = Σ 列顶高 × 格子面积
 *     剩余体积 = 柜内容积 − 已用体积
 *   再按每列顶面能不能承重、剩余高度够不够放下最薄的箱，分成三类：
 *     可承重     顶面是水平承重面，且剩余高度 ≥ 最薄箱厚 —— 物理上还能放
 *     斜面       顶层是斜顶箱单只，顶面是斜面 —— 放上去就塌
 *     高度不足   顶面能承重，但剩余高度比任何箱型都薄 —— 层数取整 / 柜高不够
 *   典型例子：斜顶箱对扣层顶面是平的（可承重），单只层顶面是斜的（不可承重）。
 *   注意：L 形台阶顶面是水平面，算「可承重」，但上面只放得下塞进缺口宽度的小箱，
 *   这是形状限制而不是不承重，界面里单独写一句。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.shapes && typeof require === 'function') NS.shapes = require('./shapes.js');
  if (!NS.solid && typeof require === 'function') NS.solid = require('./solid.js');
  if (!NS.pack && typeof require === 'function') NS.pack = require('./pack.js');
  var S = NS.shapes;
  var SOLID = NS.solid;

  var STEP = 50; // mm

  function minThickness(items) {
    var min = Infinity;
    (items || []).forEach(function (it) {
      if (!it.placeable) return;
      var poses = NS.pack.posesFor(it);
      poses.forEach(function (p) {
        if (p.thickness > 0 && p.thickness < min) min = p.thickness;
      });
    });
    return Number.isFinite(min) ? min : 0;
  }

  /** 这一箱有没有可以承重的水平顶面（按真实几何，侧放/倒扣也算） */
  function bearsOnTop(item, p) {
    if (!item || !NS.pack.facesRel) return true;
    var f = NS.pack.facesRel(item, p.pose, p.l, p.w, p.h);
    return !!(f && f.top && f.top.length);
  }

  function space(pack) {
    var c = pack.container;
    var L = c.innerL;
    var W = c.innerW;
    var H = c.innerH;
    var nx = Math.max(1, Math.ceil(L / STEP));
    var ny = Math.max(1, Math.ceil(W / STEP));
    var dA = (L / nx) * (W / ny);
    var n = nx * ny;
    var top = new Float64Array(n);
    var bear = new Uint8Array(n); // 先全部按「不承重」算，最后由真实顶面标回来

    var itemsById = {};
    (pack.items || []).forEach(function (it) { itemsById[it.id] = it; });

    function cellRange(x, y, l, w) {
      return {
        i0: Math.max(0, Math.floor(x / (L / nx))),
        i1: Math.min(nx - 1, Math.ceil((x + l) / (L / nx)) - 1),
        j0: Math.max(0, Math.floor(y / (W / ny))),
        j1: Math.min(ny - 1, Math.ceil((y + w) / (W / ny)) - 1)
      };
    }

    function stampRect(p, topZ) {
      var r = cellRange(p.x, p.y, p.l, p.w);
      for (var i = r.i0; i <= r.i1; i++) {
        for (var j = r.j0; j <= r.j1; j++) {
          var idx = j * nx + i;
          if (topZ > top[idx]) top[idx] = topZ;
        }
      }
    }

    (pack.placements || []).forEach(function (p) {
      var it = itemsById[p.skuId];
      var vertical = !p.pose || Math.abs(p.pose[8]) > 0.5; // 姿态里箱高朝上
      if (!it || it.shape === 'rect' || !vertical) {
        stampRect(p, p.z + p.h);
        return;
      }
      // L 形 / 斜顶：顶面高度随位置变化，逐格算真实顶高，不能拿外接体冒充
      var r = cellRange(p.x, p.y, p.l, p.w);
      for (var i = r.i0; i <= r.i1; i++) {
        for (var j = r.j0; j <= r.j1; j++) {
          var X = (i + 0.5) * (L / nx);
          var Y = (j + 0.5) * (W / ny);
          var span = SOLID.spanAt(p, it, X, Y);
          if (!span) continue;
          var idx = j * nx + i;
          if (span[1] > top[idx]) top[idx] = span[1];
        }
      }
    });

    // 承重面：把每一箱的真实顶面标回格子（只有顶面高度对得上的格子才算能承重）
    (pack.placements || []).forEach(function (p) {
      var it = itemsById[p.skuId];
      if (!it || !NS.pack.facesRel) return;
      var f = NS.pack.facesRel(it, p.pose, p.l, p.w, p.h);
      (f.top || []).forEach(function (face) {
        var h = p.z + face.z;
        var r = cellRange(p.x + face.x, p.y + face.y, face.l, face.w);
        for (var i = r.i0; i <= r.i1; i++) {
          for (var j = r.j0; j <= r.j1; j++) {
            var idx = j * nx + i;
            if (Math.abs(top[idx] - h) <= 1) bear[idx] = 1;
          }
        }
      });
    });

    (pack.dunnage || []).forEach(function (d) {
      var h = d.z + d.h;
      stampRect(d, h);
      var r = cellRange(d.x, d.y, d.l, d.w);
      for (var i = r.i0; i <= r.i1; i++) {
        for (var j = r.j0; j <= r.j1; j++) {
          var idx = j * nx + i;
          if (Math.abs(top[idx] - h) <= 1) bear[idx] = 1;
        }
      }
    });

    // 柜底（没被任何箱子占的格子）本身可以承重
    for (var q = 0; q < n; q++) if (top[q] <= 0.5) bear[q] = 1;

    var minT = minThickness(pack.items);
    var used = 0;
    var slopeTop = 0;
    var heightShort = 0;
    var bearingCells = [];
    for (var k = 0; k < n; k++) {
      var t = top[k];
      used += t * dA;
      var rem = Math.max(0, H - t);
      var vol = rem * dA;
      if (t > 0 && !bear[k]) slopeTop += vol;
      else if (rem < minT) heightShort += vol;
      else bearingCells.push(k);
    }

    // 可承重但「放不下一整箱」：顶面高低不齐或太碎，一只箱的底面跨不过去。
    // 按同高的连通块算面积，再看有没有哪种箱型的底面积放得进去。
    var seen = new Uint8Array(n);
    var posesByItem = (pack.items || []).filter(function (it) { return it.placeable; }).map(function (it) {
      return { it: it, poses: NS.pack.posesFor(it) };
    });
    var fitsAny = function (wl, ww) {
      for (var a = 0; a < posesByItem.length; a++) {
        var ps = posesByItem[a].poses;
        for (var b = 0; b < ps.length; b++) {
          var p = ps[b];
          if ((p.fx <= wl + 1 && p.fy <= ww + 1) || (p.fx <= ww + 1 && p.fy <= wl + 1)) return true;
        }
      }
      return false;
    };
    var bearing = 0;
    var fragment = 0;
    var floorGap = 0;
    var stack = [];
    for (var s = 0; s < bearingCells.length; s++) {
      var start = bearingCells[s];
      if (seen[start]) continue;
      var baseTop = top[start];
      var queue = [start];
      seen[start] = 1;
      var area = 0;
      var minI = 1e9, maxI = -1e9, minJ = 1e9, maxJ = -1e9;
      while (queue.length) {
        var cur = queue.pop();
        var ci = cur % nx;
        var cj = (cur - ci) / nx;
        area++;
        if (ci < minI) minI = ci;
        if (ci > maxI) maxI = ci;
        if (cj < minJ) minJ = cj;
        if (cj > maxJ) maxJ = cj;
        var nb = [cur - 1, cur + 1, cur - nx, cur + nx];
        for (var q = 0; q < 4; q++) {
          var ni = nb[q];
          if (ni < 0 || ni >= n || seen[ni]) continue;
          if (q === 0 && ci === 0) continue;
          if (q === 1 && ci === nx - 1) continue;
          if (!bear[ni]) continue;
          if (Math.abs(top[ni] - baseTop) > 1) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      var vol2 = area * dA * Math.max(0, H - baseTop);
      var wl = (maxI - minI + 1) * (L / nx);
      var ww = (maxJ - minJ + 1) * (W / ny);
      if (fitsAny(wl, ww)) bearing += vol2;
      else fragment += vol2;
      if (baseTop <= 0.5) floorGap += vol2;
      stack.push({ top: baseTop, area: area * dA, wl: wl, ww: ww, fits: fitsAny(wl, ww) });
    }

    return {
      total: L * W * H,
      used: used,
      remaining: Math.max(0, L * W * H - used),
      bearing: bearing,
      nonBearing: slopeTop + heightShort + fragment,
      slopeTop: slopeTop,
      heightShort: heightShort,
      fragment: fragment,
      floorGap: floorGap,
      stacks: stack,
      minThickness: minT,
      grid: { nx: nx, ny: ny, step: STEP }
    };
  }

  /** 为什么停：停止原因 + 每个没装完的 SKU 的物理诊断 */
  function stopText(pack) {
    var base = pack.stop ? pack.stop.message : '';
    var items = [];
    (pack.items || []).forEach(function (it) {
      if (it.remaining <= 0) return;
      var name = it.name || (it.shapeName + ' #' + (it.index + 1));
      var why = it.stack ? it.stack.message : (it.reason && it.reason.message ? it.reason.message : '未能装入');
      items.push({ name: name, remaining: it.remaining, why: why, reason: it.reason ? it.reason.message : '' });
    });
    return {
      base: base,
      items: items,
      text: [base].concat(items.map(function (m) { return m.name + '：' + m.why; })).filter(Boolean).join('；')
    };
  }

  /**
   * 解锁对比：在「当前方案同一策略」下，把某个开关打开再算一遍（真跑，不估）。
   * 只报有提升的项，没有提升就不出现，避免「勾了也没用」的假建议。
   */
  function unlocks(state, pack, planSet) {
    var out = [];
    if (!state || !NS.pack) return out;
    var best = planSet && planSet.best;
    var cfg = best ? best.config : null;
    var baseBoxes = pack.totals.loadedCount;

    function rerun(mutateRows, mutateOptions) {
      var rows = (state.rows || []).map(function (r) {
        return Object.assign({}, r, cfg ? {
          allowFlip: cfg.policy.allowFlip && !!r.allowFlip,
          allowSide: cfg.policy.allowSide && !!r.allowSide
        } : {});
      });
      rows = mutateRows ? mutateRows(rows) : rows;
      var options = {
        allowFill: cfg ? cfg.fill : !!(state.options && state.options.allowFill),
        allowDunnage: cfg ? cfg.dunnage : !!(state.options && state.options.allowDunnage),
        sortBy: cfg ? cfg.order : undefined
      };
      options = mutateOptions ? mutateOptions(options) : options;
      var p = NS.pack.run({ container: state.container || {}, rows: rows, options: options });
      return p.totals.loadedCount;
    }

    // 允许侧放：只有用户给某个 SKU 关掉了才可能有提升
    var canSide = (state.rows || []).some(function (r) { return !r.allowSide; });
    if (canSide) {
      var sideNames = (state.rows || []).filter(function (r) { return !r.allowSide; })
        .map(function (r) { return r.name || r.shape; });
      var nSide = rerun(function (rows) { return rows.map(function (r) { return Object.assign({}, r, { allowSide: true }); }); });
      if (nSide > baseBoxes) {
        out.push({
          key: 'side', label: '给 ' + sideNames.join('、') + ' 打开「允许侧放」',
          boxes: nSide, delta: nSide - baseBoxes, note: '箱子的长或宽朝上放'
        });
      }
    }

    // 允许倒放：斜顶/L 形才有意义（矩形倒放没有收益）
    var canFlip = (state.rows || []).some(function (r) { return !r.allowFlip && r.shape !== 'rect'; });
    if (canFlip) {
      var flipNames = (state.rows || []).filter(function (r) { return !r.allowFlip && r.shape !== 'rect'; })
        .map(function (r) { return r.name || r.shape; });
      var nFlip = rerun(function (rows) {
        return rows.map(function (r) { return Object.assign({}, r, { allowFlip: r.shape === 'rect' ? r.allowFlip : true }); });
      });
      if (nFlip > baseBoxes) {
        out.push({
          key: 'flip', label: '给 ' + flipNames.join('、') + ' 打开「允许倒放」',
          boxes: nFlip, delta: nFlip - baseBoxes, note: '一正一倒对扣，顶面变平后才能继续叠'
        });
      }
    }

    // 跨 SKU 填缝
    if (!(state.options && state.options.allowFill)) {
      var nFill = rerun(null, function (o) { return Object.assign({}, o, { allowFill: true }); });
      if (nFill > baseBoxes) {
        out.push({ key: 'fill', label: '打开「跨 SKU 填缝」', boxes: nFill, delta: nFill - baseBoxes, note: '用别的箱型塞本层余缝' });
      }
    }

    // 垫块：需要自备，单独的说清楚
    var gated = planSet && planSet.bestGated;
    if (gated && gated.boxes > baseBoxes) {
      out.push({
        key: 'dunnage',
        label: '用垫块填平 L 形缺口',
        boxes: gated.boxes,
        delta: gated.boxes - baseBoxes,
        note: '需自备 ' + gated.dunnageBlocks + ' 块垫块（非货品，不计箱数）',
        gated: true
      });
    }
    return out;
  }

  /**
   * 「本柜还能再装多少箱」：输入数量小于柜容量时，用户真正想知道的是这个数。
   * 按当前方案同一套策略/开关，把每行数量放大再跑一遍，多出来的部分就是余量。
   * 只在全部装完（剩余 0）时调用；装不完时谈「还能装多少」没有意义。
   */
  function headroom(state, pack, planSet) {
    if (!state || !pack || pack.totals.remainingCount > 0) return null;
    if (!NS.pack) return null;
    var cfg = planSet && planSet.best ? planSet.best.config : null;
    var rows = (state.rows || []).map(function (r) {
      var q = S.toNum(r.qty);
      if (!Number.isFinite(q) || q <= 0) q = 1;
      return Object.assign({}, r, {
        qty: String(Math.round(q) + 2000),
        allowFlip: cfg ? (cfg.policy.allowFlip && !!r.allowFlip) : !!r.allowFlip,
        allowSide: cfg ? (cfg.policy.allowSide && !!r.allowSide) : !!r.allowSide
      });
    });
    var p = NS.pack.run({
      container: state.container || {},
      rows: rows,
      options: {
        allowFill: cfg ? cfg.fill : !!(state.options && state.options.allowFill),
        allowDunnage: cfg ? cfg.dunnage : !!(state.options && state.options.allowDunnage),
        sortBy: cfg ? cfg.order : undefined
      }
    });
    var capacity = p.totals.loadedCount;
    var moreBoxes = capacity - pack.totals.loadedCount;
    return {
      capacity: capacity,
      moreBoxes: Math.max(0, moreBoxes),
      moreVolume: Math.max(0, capacity - pack.totals.loadedCount) * averageNet(pack)
    };
  }

  function averageNet(pack) {
    var loaded = 0;
    var vol = 0;
    (pack.items || []).forEach(function (it) {
      loaded += it.loaded;
      vol += it.loaded * it.netVolumeEach;
    });
    return loaded > 0 ? vol / loaded : 0;
  }

  NS.explain = {
    space: space,
    stopText: stopText,
    unlocks: unlocks,
    headroom: headroom,
    STEP: STEP
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.explain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
