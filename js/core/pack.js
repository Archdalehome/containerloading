/*
 * 分层装载算法（第一版口径）。
 *
 * 规则（与需求一致）：
 *   1. 按外接体积从大到小排序 SKU。
 *   2. 逐层装：每层取当前最大且剩余未装完的 SKU，用它的外接底面在 L×W 内货架式排布
 *      （沿宽排一行、整行推进），允许水平 90° 旋转，取每层箱数多的朝向。
 *   3. 层厚 = 该 SKU 的外接高度；累加层高，超过内高就停止。
 *   4. 累计重量超过最大载重就停止（未知重量的按 0 计，但结果会标记重量不完整）。
 *   5. 记录每箱 (x, y, z) 与朝向，供 3D 渲染。
 *
 * 基准（必须与测试一致，不许差一箱）：
 *   40HQ 内 12032×2352×2698，箱 400×300×300，重量不设限
 *     A 朝向：沿长 12032/400=30，沿宽 2352/300=7 → 每层 210
 *     B 朝向：沿长 12032/300=40，沿宽 2352/400=5 → 每层 200
 *     取 A 朝向 210/层；高度 2698/300=8 层（2400mm）→ 1680 箱
 *   净体积 1680×0.036 = 60.48 m³；40HQ 内容积约 76.351 m³；装载率 79.21%
 *
 * 已知取舍：一层只放一个 SKU，层内放不满的剩余空间不跨 SKU 补位（第二版再做）。
 * 坐标：x 沿柜长、y 沿柜宽、z 沿柜高，原点在柜门内侧左下角（单位 mm）。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.shapes && typeof require === 'function') NS.shapes = require('./shapes.js');
  var S = NS.shapes;

  var EPS = 1e-6;
  var MAX_BOXES = 50000; // 单次计算上限，防止极端输入把页面算死

  function parseContainer(c) {
    return {
      key: c.key || '集装箱',
      innerL: S.toNum(c.innerL),
      innerW: S.toNum(c.innerW),
      innerH: S.toNum(c.innerH),
      doorH: S.toNum(c.doorH),
      payload: S.toNum(c.payload)
    };
  }

  /**
   * 选朝向：比较「长边沿柜长」与「长边沿柜宽」两种摆法，取每层箱数多的。
   * 箱数相同则保持不旋转（rot=0），保证结果可复现。
   */
  function bestOrientation(bb, c) {
    var a = {
      nx: Math.floor((c.innerL + EPS) / bb.l),
      ny: Math.floor((c.innerW + EPS) / bb.w),
      rot: 0,
      l: bb.l,
      w: bb.w
    };
    var b = {
      nx: Math.floor((c.innerL + EPS) / bb.w),
      ny: Math.floor((c.innerW + EPS) / bb.l),
      rot: 90,
      l: bb.w,
      w: bb.l
    };
    a.cap = a.nx * a.ny;
    b.cap = b.nx * b.ny;
    return a.cap >= b.cap ? a : b;
  }

  function buildItems(rows, c) {
    return rows.map(function (row, idx) {
      var shape = S.get(row.shape);
      var v = row.values || {};
      var bb = shape.bbox(v);
      var qty = Math.floor(S.toNum(row.qty));
      if (!Number.isFinite(qty) || qty < 0) qty = 0;
      var w = row.weight === null || row.weight === undefined || String(row.weight).trim() === ''
        ? null
        : S.toNum(row.weight);

      var item = {
        id: row.id,
        index: idx,
        shape: shape.key,
        shapeName: shape.name,
        name: (row.name || '').trim(),
        bbox: bb,
        rawValues: Object.assign({}, v),
        // 真实几何参数，供 3D 按形状渲染（不是外接长方体）
        shapeValues: shape.key === 'lshape'
          ? { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h, wlow: S.toNum(v.Wlow), whigh: S.toNum(v.Whigh), hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
          : shape.key === 'slope'
            ? { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h, hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
            : { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h },
        qty: qty,
        unitWeight: Number.isFinite(w) ? w : null,
        netVolumeEach: shape.volume(v),
        bboxVolumeEach: bb.l * bb.w * bb.h,
        loaded: 0,
        remaining: qty,
        reason: null,
        placeable: true,
        orient: null
      };

      // 先判物理上能不能进门 / 进柜 / 落到地面
      if (bb.h > c.innerH + EPS) {
        item.placeable = false;
        item.reason = {
          code: 'too-tall',
          message: '箱高 ' + S.num(bb.h) + ' mm 超过 ' + c.key + ' 内高 ' + S.num(c.innerH) + ' mm，装不进去'
        };
      } else if (bb.h > c.doorH + EPS) {
        item.placeable = false;
        item.reason = {
          code: 'door-height',
          message: '箱高 ' + S.num(bb.h) + ' mm 超过 ' + c.key + ' 门高 ' + S.num(c.doorH) + ' mm，过不了柜门'
        };
      }

      var o = bestOrientation(bb, c);
      item.orient = o;
      if (item.placeable && o.cap === 0) {
        item.placeable = false;
        item.reason = {
          code: 'footprint',
          message: '外接底面 ' + S.num(bb.l) + '×' + S.num(bb.w) + ' mm 放不进 ' +
            c.key + ' 的 ' + S.num(c.innerL) + '×' + S.num(c.innerW) + ' mm 底面'
        };
      }
      return item;
    });
  }

  function bySizeDesc(a, b) {
    if (b.bboxVolumeEach !== a.bboxVolumeEach) return b.bboxVolumeEach - a.bboxVolumeEach;
    if (b.netVolumeEach !== a.netVolumeEach) return b.netVolumeEach - a.netVolumeEach;
    return a.index - b.index;
  }

  /** 主流程 */
  function run(state) {
    var c = parseContainer(state.container || {});
    var items = buildItems(state.rows || [], c);
    var sorted = items.slice().sort(bySizeDesc);

    var placements = [];
    var layers = [];
    var z = 0;
    var usedWeight = 0;
    var loadedCount = 0;
    var weightKnown = items.every(function (it) { return it.unitWeight !== null; });
    var stop = { code: 'all-loaded', message: '全部装载完成' };

    while (true) {
      if (loadedCount >= MAX_BOXES) {
        stop = { code: 'limit', message: '已达到单次计算上限 ' + MAX_BOXES + ' 箱' };
        break;
      }

      // 找当前放进这一层最合适的 SKU：体积最大、剩余高度放得下、底面放得下
      var cand = null;
      for (var i = 0; i < sorted.length; i++) {
        var it = sorted[i];
        if (it.remaining <= 0 || !it.placeable) continue;
        if (it.bbox.h > c.innerH - z + EPS) continue;
        if (it.orient.cap <= 0) continue;
        cand = it;
        break;
      }
      if (!cand) {
        var anyPlaceable = sorted.some(function (x) {
          return x.remaining > 0 && x.placeable;
        });
        if (!anyPlaceable) {
          stop = { code: 'all-loaded', message: '全部装载完成' };
        } else {
          var anyHeightLeft = c.innerH - z;
          stop = {
            code: 'height',
            message: '剩余高度 ' + S.num(anyHeightLeft) + ' mm，放不下任何剩余箱型'
          };
        }
        break;
      }

      var h = cand.bbox.h;
      var o = cand.orient;
      var want = Math.min(cand.remaining, o.cap);
      var canPlace = want;
      var weightBlocked = false;

      if (cand.unitWeight !== null && cand.unitWeight > 0) {
        var allowed = Math.floor((c.payload - usedWeight + EPS) / cand.unitWeight);
        if (allowed < canPlace) {
          canPlace = Math.max(0, allowed);
          weightBlocked = true;
        }
      }

      if (canPlace <= 0) {
        stop = {
          code: 'weight',
          message: '达到最大载重 ' + S.num(c.payload) + ' kg，停止装载'
        };
        break;
      }

      var layerIndex = layers.length;
      var placed = 0;
      for (var row = 0; row < o.ny && placed < canPlace; row++) {
        for (var col = 0; col < o.nx && placed < canPlace; col++) {
          placements.push({
            skuId: cand.id,
            index: items.indexOf(cand),
            col: col + 1,
            row: row + 1,
            x: col * o.l,
            y: row * o.w,
            z: z,
            l: o.l,
            w: o.w,
            h: h,
            rot: o.rot,
            layer: layerIndex
          });
          placed++;
        }
      }

      cand.loaded += placed;
      cand.remaining -= placed;
      loadedCount += placed;
      usedWeight += placed * (cand.unitWeight || 0);

      layers.push({
        index: layerIndex,
        skuId: cand.id,
        skuName: cand.name,
        shapeName: cand.shapeName,
        count: placed,
        capacity: o.cap,
        height: h,
        z: z,
        top: z + h,
        rot: o.rot
      });

      z += h;

      if (loadedCount >= MAX_BOXES) {
        stop = { code: 'limit', message: '已达到单次计算上限 ' + MAX_BOXES + ' 箱' };
        break;
      }
      if (weightBlocked && cand.remaining >= 0) {
        // 这一层已经被载重截断，下一轮 allowed 会是 0
        var anyLeft = sorted.some(function (x) { return x.remaining > 0 && x.placeable; });
        if (anyLeft) {
          var nextAllowed = cand.unitWeight
            ? Math.floor((c.payload - usedWeight + EPS) / cand.unitWeight)
            : 1;
          if (nextAllowed <= 0) {
            stop = { code: 'weight', message: '达到最大载重 ' + S.num(c.payload) + ' kg，停止装载' };
            break;
          }
        }
      }
    }

    // 逐 SKU 收尾：剩余的原因要写清楚，不许静默丢行
    var loadedNet = 0;
    var loadedOuter = 0;
    var requestedWeight = 0;
    var anyWeight = false;

    items.forEach(function (it) {
      if (!it.placeable) {
        it.loaded = 0;
        it.remaining = it.qty;
        return;
      }
      if (it.remaining > 0) {
        var room = c.innerH - z;
        if (it.bbox.h > room + EPS) {
          it.reason = {
            code: 'height',
            message: '剩余高度 ' + S.num(Math.max(0, room)) + ' mm，放不下箱高 ' + S.num(it.bbox.h) + ' mm'
          };
        } else if (stop.code === 'weight') {
          it.reason = { code: 'weight', message: '达到最大载重，停止装载' };
        } else if (stop.code === 'limit') {
          it.reason = { code: 'limit', message: '超过单次计算上限，未继续计算' };
        } else {
          it.reason = { code: 'no-space', message: '集装箱已无可用空间' };
        }
      }
      if (it.remaining > 0 && !it.reason && stop.code !== 'all-loaded') {
        it.reason = { code: stop.code, message: stop.message };
      }
      loadedNet += it.loaded * it.netVolumeEach;
      loadedOuter += it.loaded * it.bboxVolumeEach;
      if (it.unitWeight !== null) {
        requestedWeight += it.qty * it.unitWeight;
        anyWeight = true;
      }
    });

    var containerVolume = c.innerL * c.innerW * c.innerH;
    var loadedCountFinal = items.reduce(function (s, it) { return s + it.loaded; }, 0);
    var requestedCount = items.reduce(function (s, it) { return s + it.qty; }, 0);

    return {
      ok: true,
      container: c,
      items: items,
      placements: placements,
      layers: layers,
      usedHeight: z,
      containerVolume: containerVolume,
      stop: stop,
      truncated: stop.code === 'limit',
      totals: {
        requestedCount: requestedCount,
        loadedCount: loadedCountFinal,
        remainingCount: requestedCount - loadedCountFinal,
        netVolume: loadedNet,
        bboxVolume: loadedOuter,
        fillRate: containerVolume > 0 ? loadedNet / containerVolume : 0,
        spaceUsage: containerVolume > 0 ? loadedOuter / containerVolume : 0,
        weight: usedWeight,
        requestedWeight: requestedWeight,
        payload: c.payload,
        weightKnown: weightKnown && anyWeight || (weightKnown && requestedCount === 0),
        overloaded: requestedWeight > c.payload + EPS,
        layerCount: layers.length,
        heightUsage: c.innerH > 0 ? z / c.innerH : 0
      }
    };
  }

  /**
   * 剩余货物还需要几个同规格柜：把剩余量当成新的一票货，重跑同一算法，
   * 装多少减多少，直到装完 / 装不动（理论上不该发生）。
   * 物理上装不进的（超门高、底面超尺寸）不参与计算，单独报告——换柜也装不进。
   */
  function extraContainers(state, first) {
    var c = parseContainer(state.container || {});
    var pending = (first.items || []).filter(function (it) {
      return it.placeable && it.remaining > 0;
    }).map(function (it) {
      return { it: it, qty: it.remaining };
    });

    var impossible = (first.items || []).filter(function (it) {
      return !it.placeable && it.remaining > 0;
    });

    var count = 0;
    var rounds = [];
    var guard = 0;

    while (pending.some(function (r) { return r.qty > 0; }) && guard < 50) {
      guard++;
      var rows = pending.filter(function (r) { return r.qty > 0; }).map(function (r) {
        var it = r.it;
        return {
          id: it.id,
          shape: it.shape,
          name: it.name,
          values: it.rawValues || {},
          qty: String(r.qty),
          weight: it.unitWeight === null ? '' : String(it.unitWeight)
        };
      });
      var res = run({ container: state.container || {}, rows: rows });
      if (res.totals.loadedCount === 0) break;

      count++;
      rounds.push({
        loaded: res.totals.loadedCount,
        fillRate: res.totals.fillRate
      });
      var byId = {};
      res.items.forEach(function (it) { byId[it.id] = it.loaded; });
      pending.forEach(function (r) {
        r.qty -= (byId[r.it.id] || 0);
        if (r.qty < 0) r.qty = 0;
      });
    }

    var left = pending.reduce(function (s, r) { return s + r.qty; }, 0);
    var impossibleCount = impossible.reduce(function (s, it) { return s + it.remaining; }, 0);

    return {
      count: count,
      rounds: rounds,
      leftOver: left,
      truncated: guard >= 50,
      impossible: impossible,
      impossibleCount: impossibleCount,
      impossibleNames: impossible.map(function (it) {
        return it.name || (it.shapeName + ' #' + (it.index + 1));
      }),
      containerKey: c.key
    };
  }

  NS.pack = {
    run: run,
    extraContainers: extraContainers,
    bestOrientation: bestOrientation,
    MAX_BOXES: MAX_BOXES,
    /** 自检用：两箱是否在三维上相交（单位 mm） */
    overlaps: function (a, b) {
      return a.x < b.x + b.l - EPS && b.x < a.x + a.l - EPS &&
        a.y < b.y + b.w - EPS && b.y < a.y + a.w - EPS &&
        a.z < b.z + b.h - EPS && b.z < a.z + a.h - EPS;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.pack;
})(typeof globalThis !== 'undefined' ? globalThis : this);
