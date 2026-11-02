/*
 * 分层装载算法 v2。
 *
 * 与 v1 的关系：
 *   - 水平 90° 旋转始终允许；「可倒放」「可侧放」是每个 SKU 的开关，默认关。
 *   - 两个开关都关时，只在「H 朝上」的姿态里择优，结果与 v1 相同（唯一差别是 v2 会跳过悬空的箱子——
 *     v1 在混装时确实会产生 5.3% 悬空箱，属于物理错误，v2 修正）。
 *   - 斜顶对扣（一正一倒）只在「可倒放」开启时参与比较。
 *   - 跨 SKU 填缝是全局开关（state.options.allowFill），默认关；只往本层余缝里加箱，不改层高，
 *     因此箱数只会不变或变多。
 *
 * 支撑：每箱下方必须被「顶面高度等于本箱底面高度」的箱子完全覆盖（第 0 层由柜底支撑）。
 * 覆盖判断用扫描线，见 covers()。
 *
 * 基准（重量不设限，必须与测试一致）：
 *   40HQ 12032×2352×2698，箱 400×300×300 → 30×7=210/层，8 层 → 1680 箱，装载率 79.21%。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.shapes && typeof require === 'function') NS.shapes = require('./shapes.js');
  var S = NS.shapes;

  var EPS = 1e-6;
  var MAX_BOXES = 50000;

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

  /* ---------- 姿态：立方体的 24 个旋转，按开关过滤 ---------- */

  var PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  var PERM_SIGN = { '0,1,2': 1, '0,2,1': -1, '1,0,2': -1, '1,2,0': 1, '2,0,1': 1, '2,1,0': -1 };

  var ALL_ROTATIONS = (function () {
    var out = [];
    PERMS.forEach(function (p) {
      var ps = PERM_SIGN[p.join(',')];
      for (var s0 = 1; s0 >= -1; s0 -= 2) {
        for (var s1 = 1; s1 >= -1; s1 -= 2) {
          for (var s2 = 1; s2 >= -1; s2 -= 2) {
            var s = [s0, s1, s2];
            if (ps * s0 * s1 * s2 !== 1) continue;
            var m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (var a = 0; a < 3; a++) m[p[a] * 3 + a] = s[a];
            out.push({ m: m, p: p, s: s });
          }
        }
      }
    });
    return out;
  })();

  /** 姿态在本容器里的外廓：thickness 竖直，fx/fy 水平两个方向 */
  function poseDims(item, pose) {
    var d = [item.bbox.l, item.bbox.w, item.bbox.h];
    var fx = 0;
    var fy = 0;
    var fz = 0;
    for (var a = 0; a < 3; a++) {
      var row = pose.p[a]; // 局部轴 a 映射到的容器轴
      if (row === 0) fx = d[a];
      else if (row === 1) fy = d[a];
      else fz = d[a];
    }
    return { fx: fx, fy: fy, thickness: fz };
  }

  /**
   * 允许的姿态：水平旋转始终允许；侧放（L/W 朝上）要开关；任何「底面朝上」的姿态要可倒放。
   * 按 item 生成并去重，顺序固定，便于复现。
   */
  function posesFor(item) {
    var out = [];
    var seen = {};
    for (var i = 0; i < ALL_ROTATIONS.length; i++) {
      var rot = ALL_ROTATIONS[i];
      var dims = poseDims(item, rot);
      // 哪个局部轴竖直、朝上还是朝下
      var vertical = -1;
      var upSign = 0;
      for (var a = 0; a < 3; a++) {
        if (rot.p[a] === 2) {
          vertical = a;
          upSign = rot.s[a];
        }
      }
      if (vertical === -1) continue;
      var isSide = vertical !== 2;
      var isFlip = upSign < 0;

      if (isSide && !item.allowSide) continue;
      if (isFlip && !item.allowFlip) continue;
      // H 朝上但底朝上（即倒放）已在 isFlip 里处理；侧放且底朝上同样需要可倒放

      var key = vertical + '|' + dims.fx + '|' + dims.fy + '|' + (isFlip ? 1 : 0);
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        m: rot.m,
        p: rot.p,
        s: rot.s,
        fx: dims.fx,
        fy: dims.fy,
        thickness: dims.thickness,
        side: isSide,
        flip: isFlip,
        vertical: vertical
      });
    }
    return out;
  }

  function capacityOf(pose, c) {
    var nx = Math.floor((c.innerL + EPS) / pose.fx);
    var ny = Math.floor((c.innerW + EPS) / pose.fy);
    return { nx: Math.max(0, nx), ny: Math.max(0, ny), cap: Math.max(0, nx) * Math.max(0, ny) };
  }

  /**
   * 在允许姿态里挑「剩余高度内能装最多箱」的：
   *   score = floor(剩余高度 / 层厚) × 每层箱数
   * 只看每层箱数/层厚会在层数取整时倒挂（例如 500 厚能叠 5 层、600 厚只能 4 层），
   * 所以直接把剩余高度算进去。同分保持先出现的姿态（H 朝上、不旋转），与 v1 一致。
   */
  function bestPose(item, c, roomH) {
    var poses = posesFor(item);
    var best = null;
    var bestTotal = -1;
    for (var i = 0; i < poses.length; i++) {
      var pose = poses[i];
      if (pose.thickness > roomH + EPS) continue;
      if (pose.thickness > c.doorH + EPS) continue;
      var cap = capacityOf(pose, c);
      if (cap.cap <= 0) continue;
      var layers = Math.floor((roomH + EPS) / pose.thickness);
      var total = layers * cap.cap;
      if (total > bestTotal) {
        best = pose;
        bestTotal = total;
      }
    }
    return best;
  }

  /* ---------- 支撑判断 ---------- */

  /** 矩形 F 是否被 rects 的并集完全覆盖（扫描线） */
  function covers(F, rects) {
    var eps = 1e-6;
    var rs = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.x < F.x + F.l - eps && r.x + r.l > F.x + eps &&
          r.y < F.y + F.w - eps && r.y + r.w > F.y + eps) {
        rs.push({
          x: Math.max(r.x, F.x),
          y: Math.max(r.y, F.y),
          x2: Math.min(r.x + r.l, F.x + F.l),
          y2: Math.min(r.y + r.w, F.y + F.w)
        });
      }
    }
    if (!rs.length) return false;
    var xs = [F.x, F.x + F.l];
    rs.forEach(function (r) { xs.push(r.x, r.x2); });
    xs = xs.filter(function (v, idx) { return xs.indexOf(v) === idx; }).sort(function (a, b) { return a - b; });

    for (var k = 0; k < xs.length - 1; k++) {
      var x0 = xs[k];
      var x1 = xs[k + 1];
      if (x1 - x0 < eps) continue;
      var iv = [];
      for (var j = 0; j < rs.length; j++) {
        if (rs[j].x <= x0 + eps && rs[j].x2 >= x1 - eps) iv.push([rs[j].y, rs[j].y2]);
      }
      iv.sort(function (a, b) { return a[0] - b[0]; });
      var y = F.y;
      for (var q = 0; q < iv.length; q++) {
        if (iv[q][0] > y + eps) break;
        if (iv[q][1] > y) y = iv[q][1];
      }
      if (y < F.y + F.w - eps) return false;
    }
    return true;
  }

  /* ---------- 构建 SKU ---------- */

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
        shapeValues: shape.key === 'lshape'
          ? { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h, wlow: S.toNum(v.Wlow), whigh: S.toNum(v.Whigh), hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
          : shape.key === 'slope'
            ? { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h, hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
            : { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h },
        qty: qty,
        unitWeight: Number.isFinite(w) ? w : null,
        netVolumeEach: shape.volume(v),
        bboxVolumeEach: bb.l * bb.w * bb.h,
        allowFlip: !!row.allowFlip,
        allowSide: !!row.allowSide,
        loaded: 0,
        remaining: qty,
        reason: null,
        placeable: true
      };

      if (bb.h > c.innerH + EPS) {
        item.placeable = false;
        item.reason = { code: 'too-tall', message: '箱高 ' + S.num(bb.h) + ' mm 超过 ' + c.key + ' 内高 ' + S.num(c.innerH) + ' mm，装不进去' };
      } else if (bb.h > c.doorH + EPS) {
        item.placeable = false;
        item.reason = { code: 'door-height', message: '箱高 ' + S.num(bb.h) + ' mm 超过 ' + c.key + ' 门高 ' + S.num(c.doorH) + ' mm，过不了柜门' };
      }

      var probe = bestPose(item, c, c.innerH);
      if (item.placeable && !probe) {
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

  /* ---------- 主流程 ---------- */

  function run(state) {
    var c = parseContainer(state.container || {});
    var opts = state.options || {};
    var allowFill = !!opts.allowFill;
    var items = buildItems(state.rows || [], c);
    var sorted = items.slice().sort(bySizeDesc);

    var placements = [];
    var layers = [];
    var z = 0;
    var usedWeight = 0;
    var loadedCount = 0;
    var weightKnown = items.every(function (it) { return it.unitWeight !== null; });
    var stop = { code: 'all-loaded', message: '全部装载完成' };

    // 支撑索引：key 为顶面高度，值为该高度的箱体底面矩形
    var topIndex = {};

    function keyOf(h) { return Math.round(h * 1000); }

    function addSupport(p) {
      var k = keyOf(p.z + p.h);
      (topIndex[k] = topIndex[k] || []).push({ x: p.x, y: p.y, l: p.l, w: p.w });
    }

    function supportedAt(x, y, l, w, zz) {
      if (zz <= EPS) return true;
      var rects = topIndex[keyOf(zz)];
      if (!rects || !rects.length) return false;
      return covers({ x: x, y: y, l: l, w: w }, rects);
    }

    function weightRoom() {
      if (!weightKnown) return Infinity;
      return Math.max(0, c.payload - usedWeight);
    }

    while (true) {
      if (loadedCount >= MAX_BOXES) {
        stop = { code: 'limit', message: '已达到单次计算上限 ' + MAX_BOXES + ' 箱' };
        break;
      }

      var cand = null;
      var candPose = null;
      for (var i = 0; i < sorted.length; i++) {
        var it = sorted[i];
        if (it.remaining <= 0 || !it.placeable) continue;
        var pose = bestPose(it, c, c.innerH - z);
        if (!pose) continue;
        // 单层里至少能放下一箱（原点那一格是否被支撑不影响后面几格，这里粗略放行）
        cand = it;
        candPose = pose;
        break;
      }
      if (!cand) {
        var anyPlaceable = sorted.some(function (x) { return x.remaining > 0 && x.placeable; });
        stop = anyPlaceable
          ? { code: 'height', message: '剩余高度 ' + S.num(Math.max(0, c.innerH - z)) + ' mm，放不下任何剩余箱型' }
          : { code: 'all-loaded', message: '全部装载完成' };
        break;
      }

      var posCap = capacityOf(candPose, c);

      // 斜顶对扣：一正一倒，每对占 H低+H高；底件固定用「正放」，和最优单层方案比总箱数
      var pair = null;
      if (cand.shape === 'slope' && cand.allowFlip) {
        var sv = cand.shapeValues;
        var pairThickness = sv.hlow + sv.h;
        var roomLeft = c.innerH - z;
        var hup = findNormalPose(cand);
        if (hup && pairThickness <= roomLeft + EPS && pairThickness <= c.doorH + EPS && cand.remaining >= 2) {
          var hupCap = capacityOf(hup, c);
          var flipPose = findFlipPose(cand, hup);
          if (flipPose && hupCap.cap > 0) {
            var singleTotal = Math.floor((roomLeft + EPS) / candPose.thickness) * posCap.cap;
            var pairLayers = Math.floor((roomLeft + EPS) / pairThickness);
            var pairsPerLayer = Math.min(Math.floor(cand.remaining / 2), hupCap.cap);
            var pairTotal = pairLayers * pairsPerLayer * 2;
            if (pairTotal >= singleTotal) {
              pair = {
                thickness: pairThickness,
                lower: hup,
                upper: flipPose,
                cap: hupCap,
                pairsPerLayer: pairsPerLayer
              };
            }
          }
        }
      }

      var thickness = pair ? pair.thickness : candPose.thickness;
      var nx = pair ? pair.cap.nx : posCap.nx;
      var ny = pair ? pair.cap.ny : posCap.ny;
      var capacity = pair ? pair.cap.cap : posCap.cap;

      var layerIndex = layers.length;
      var placed = 0;
      var fillTotal = 0;
      var layerZ = z;
      var layerFill = [];
      var unitW = cand.unitWeight || 0;

      if (pair) {
        var maxPairs = Math.min(capacity, Math.floor(cand.remaining / 2));
        if (weightKnown && unitW > 0) {
          maxPairs = Math.min(maxPairs, Math.floor(weightRoom() / (2 * unitW)));
        }
        var pairsPlaced = 0;
        for (var pr = 0; pr < ny && pairsPlaced < maxPairs; pr++) {
          for (var pc = 0; pc < nx && pairsPlaced < maxPairs; pc++) {
            var px = pc * pair.lower.fx;
            var py = pr * pair.lower.fy;
            if (!supportedAt(px, py, pair.lower.fx, pair.lower.fy, layerZ)) continue;
            var lower = {
              skuId: cand.id, index: items.indexOf(cand), col: pc + 1, row: pr + 1,
              x: px, y: py, z: layerZ, l: pair.lower.fx, w: pair.lower.fy, h: pair.lower.thickness,
              rot: 0, layer: layerIndex, pose: pair.lower.m, kind: 'pair-lower'
            };
            var upper = {
              skuId: cand.id, index: items.indexOf(cand), col: pc + 1, row: pr + 1,
              x: px, y: py, z: layerZ + cand.shapeValues.hlow,
              l: pair.upper.fx, w: pair.upper.fy, h: pair.upper.thickness,
              rot: 90, layer: layerIndex, pose: pair.upper.m, kind: 'pair-upper'
            };
            placements.push(lower);
            addSupport(lower);
            placements.push(upper);
            addSupport(upper);
            placed += 2;
            pairsPlaced++;
          }
        }
      } else {
        var room = Math.min(cand.remaining, capacity);
        if (weightKnown && unitW > 0) room = Math.min(room, Math.floor(weightRoom() / unitW));
        for (var r = 0; r < ny && placed < room; r++) {
          for (var col = 0; col < nx && placed < room; col++) {
            var bx = col * candPose.fx;
            var by = r * candPose.fy;
            if (!supportedAt(bx, by, candPose.fx, candPose.fy, layerZ)) continue;
            var p = {
              skuId: cand.id, index: items.indexOf(cand), col: col + 1, row: r + 1,
              x: bx, y: by, z: layerZ, l: candPose.fx, w: candPose.fy, h: candPose.thickness,
              rot: candPose.fx === cand.bbox.l ? 0 : 90,
              layer: layerIndex, pose: candPose.m, kind: candPose.side ? 'side' : (candPose.flip ? 'flip' : 'normal')
            };
            placements.push(p);
            addSupport(p);
            placed++;
          }
        }
      }

      if (placed === 0) {
        stop = { code: 'no-support', message: '剩余箱型下方没有可支撑的面，停止装载' };
        break;
      }

      var layerTop = pair ? layerZ + pair.thickness : layerZ + candPose.thickness;

      // 先把本层主箱型记账，再填缝——否则填缝会把同一 SKU 的剩余量重复算进去
      cand.loaded += placed;
      cand.remaining -= placed;
      loadedCount += placed;
      usedWeight += placed * unitW;

      // 填缝：只往本层剩下的两条带里加箱，层高不变
      if (allowFill && !pair) {
        var usedX = Math.min(nx * candPose.fx, c.innerL);
        var usedY = Math.min(ny * candPose.fy, c.innerW);
        var strips = [
          { x: usedX, y: 0, l: c.innerL - usedX, w: c.innerW },
          { x: 0, y: usedY, l: usedX, w: c.innerW - usedY }
        ];
        strips.forEach(function (strip) {
          if (strip.l <= EPS || strip.w <= EPS) return;
          var filler = pickFiller(strip, thickness, z, cand, items, sorted, c, weightKnown, usedWeight);
          if (!filler) return;
          var fRemaining = filler.item.remaining;
          var fMax = Math.min(filler.cap.cap, fRemaining);
          if (weightKnown && filler.item.unitWeight > 0) {
            fMax = Math.min(fMax, Math.floor((c.payload - usedWeight) / filler.item.unitWeight));
          }
          var fPlaced = 0;
          for (var fr = 0; fr < filler.cap.ny && fPlaced < fMax; fr++) {
            for (var fc = 0; fc < filler.cap.nx && fPlaced < fMax; fc++) {
              var fx0 = strip.x + fc * filler.pose.fx;
              var fy0 = strip.y + fr * filler.pose.fy;
              if (fx0 + filler.pose.fx > strip.x + strip.l + EPS) continue;
              if (fy0 + filler.pose.fy > strip.y + strip.w + EPS) continue;
              if (!supportedAt(fx0, fy0, filler.pose.fx, filler.pose.fy, z)) continue;
              if (filler.pose.thickness > thickness + EPS) continue;
              var fp = {
                skuId: filler.item.id, index: items.indexOf(filler.item),
                col: fc + 1, row: fr + 1,
                x: fx0, y: fy0, z: z, l: filler.pose.fx, w: filler.pose.fy, h: filler.pose.thickness,
                rot: 0, layer: layerIndex, pose: filler.pose.m, kind: 'fill'
              };
              placements.push(fp);
              addSupport(fp);
              fPlaced++;
              filler.item.loaded++;
              filler.item.remaining--;
              loadedCount++;
              fillTotal++;
              usedWeight += (filler.item.unitWeight || 0);
            }
          }
          if (fPlaced > 0) {
            layerFill.push({ skuId: filler.item.id, name: filler.item.name, count: fPlaced });
          }
        });
      }

      layers.push({
        index: layerIndex,
        skuId: cand.id,
        skuName: cand.name,
        shapeName: cand.shapeName,
        count: placed + fillTotal,
        capacity: pair ? capacity * 2 : capacity,
        height: thickness,
        z: layerZ,
        top: layerTop,
        rot: pair ? 90 : (candPose.fx === cand.bbox.l ? 0 : 90),
        kind: pair ? 'pair' : (candPose.side ? 'side' : (candPose.flip ? 'flip' : 'normal')),
        fill: layerFill,
        pose: pair ? null : candPose.m
      });

      z = layerTop;

      if (weightKnown && unitW > 0 && weightRoom() < unitW) {
        stop = { code: 'weight', message: '达到最大载重 ' + S.num(c.payload) + ' kg，停止装载' };
        break;
      }
      if (loadedCount >= MAX_BOXES) {
        stop = { code: 'limit', message: '已达到单次计算上限 ' + MAX_BOXES + ' 箱' };
        break;
      }
    }

    // 收尾：剩余原因
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
        var room2 = c.innerH - z;
        if (it.bbox.h > room2 + EPS) {
          it.reason = { code: 'height', message: '剩余高度 ' + S.num(Math.max(0, room2)) + ' mm，放不下箱高 ' + S.num(it.bbox.h) + ' mm' };
        } else if (stop.code === 'weight') {
          it.reason = { code: 'weight', message: '达到最大载重，停止装载' };
        } else if (stop.code === 'limit') {
          it.reason = { code: 'limit', message: '超过单次计算上限，未继续计算' };
        } else if (stop.code === 'no-support') {
          it.reason = { code: 'no-support', message: '下方没有可支撑的箱面，停止装载' };
        } else {
          it.reason = { code: 'no-space', message: '集装箱已无可用空间' };
        }
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
      options: { allowFill: allowFill },
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
        weightKnown: (weightKnown && anyWeight) || (weightKnown && requestedCount === 0),
        overloaded: requestedWeight > c.payload + EPS,
        layerCount: layers.length,
        heightUsage: c.innerH > 0 ? z / c.innerH : 0
      }
    };
  }

  /** 正放姿态（H 朝上、不倒放），对扣底件用 */
  function findNormalPose(item) {
    var poses = posesFor(item);
    for (var i = 0; i < poses.length; i++) {
      if (poses[i].vertical === 2 && !poses[i].flip) return poses[i];
    }
    return null;
  }

  /** 在允许姿态里找「底面朝上」的那一个（对扣上件用，必须与下件同底面积） */
  function findFlipPose(item, refPose) {
    var poses = posesFor(item);
    for (var i = 0; i < poses.length; i++) {
      var p = poses[i];
      if (!p.flip || p.vertical !== 2) continue;
      if (Math.abs(p.fx - refPose.fx) < EPS && Math.abs(p.fy - refPose.fy) < EPS) return p;
    }
    return null;
  }

  /** 给一条余缝挑填缝箱：厚度不超过本层，格数最多 */
  function pickFiller(strip, thickness, z, baseItem, items, sorted, c, weightKnown, usedWeight) {
    var best = null;
    for (var i = 0; i < sorted.length; i++) {
      var it = sorted[i];
      if (it.remaining <= 0 || !it.placeable) continue;
      if (it.id === baseItem.id && it.remaining <= 0) continue;
      var poses = posesFor(it);
      for (var j = 0; j < poses.length; j++) {
        var pose = poses[j];
        if (pose.thickness > thickness + EPS) continue;
        var nx = Math.floor((strip.l + EPS) / pose.fx);
        var ny = Math.floor((strip.w + EPS) / pose.fy);
        if (nx <= 0 || ny <= 0) continue;
        var cap = nx * ny;
        if (!best || cap > best.cap.cap) {
          best = { item: it, pose: pose, cap: { nx: nx, ny: ny, cap: cap } };
        }
      }
    }
    return best;
  }

  /* ---------- 补柜 ---------- */

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
          weight: it.unitWeight === null ? '' : String(it.unitWeight),
          allowFlip: it.allowFlip,
          allowSide: it.allowSide
        };
      });
      var res = run({ container: state.container || {}, rows: rows, options: state.options || {} });
      if (res.totals.loadedCount === 0) break;

      count++;
      rounds.push({
        loaded: res.totals.loadedCount,
        fillRate: res.totals.fillRate,
        netVolume: res.totals.netVolume,
        weight: res.totals.weight,
        weightKnown: res.totals.weightKnown,
        containerVolume: res.containerVolume,
        payload: res.container.payload
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
    // 兼容旧接口
    bestOrientation: function (bb, c) {
      var a = { nx: Math.floor((c.innerL + EPS) / bb.l), ny: Math.floor((c.innerW + EPS) / bb.w), rot: 0, l: bb.l, w: bb.w };
      var b = { nx: Math.floor((c.innerL + EPS) / bb.w), ny: Math.floor((c.innerW + EPS) / bb.l), rot: 90, l: bb.w, w: bb.l };
      a.cap = a.nx * a.ny;
      b.cap = b.nx * b.ny;
      return a.cap >= b.cap ? a : b;
    },
    posesFor: posesFor,
    covers: covers,
    MAX_BOXES: MAX_BOXES,
    overlaps: function (a, b) {
      return a.x < b.x + b.l - EPS && b.x < a.x + a.l - EPS &&
        a.y < b.y + b.w - EPS && b.y < a.y + a.w - EPS &&
        a.z < b.z + b.h - EPS && b.z < a.z + a.h - EPS;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.pack;
})(typeof globalThis !== 'undefined' ? globalThis : this);
