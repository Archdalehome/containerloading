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

      // 斜顶箱只允许正放与配对用倒放：侧放后顶面不是完整水平面，叠不了，没有实用价值
      if (item.shape === 'slope' && isSide) continue;
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
      // 倒放只允许出现在对扣里：单独倒放的斜面朝下/箱子倒扣都不合法
      if (pose.flip) continue;
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

  /**
   * L 形箱正放时的水平台阶面（局部 x∈[0,L]、y∈[0,W低]、z=H低），返回容器坐标矩形。
   * 只有正放（姿态矩阵的竖直轴朝上）才有水平台阶面；倒放、侧放的台阶是竖面，不承重。
   */
  /** 把箱体局部坐标系里的一个水平矩形映射到容器坐标（处理带负号的姿态矩阵） */
  function mapLocalRect(item, p, x0, x1, y0, y1, zLocal) {
    var sv = item.shapeValues;
    var m = p.pose || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var minX = Infinity;
    var minY = Infinity;
    for (var i = 0; i < 8; i++) {
      var vx = (i & 1) ? sv.l : 0;
      var vy = (i & 2) ? sv.w : 0;
      var vz = (i & 4) ? sv.h : 0;
      minX = Math.min(minX, m[0] * vx + m[1] * vy + m[2] * vz);
      minY = Math.min(minY, m[3] * vx + m[4] * vy + m[5] * vz);
    }
    var xs = [];
    var ys = [];
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(function (c) {
      xs.push(p.x + (m[0] * c[0] + m[1] * c[1] + m[2] * zLocal) - minX);
      ys.push(p.y + (m[3] * c[0] + m[4] * c[1] + m[5] * zLocal) - minY);
    });
    var ax = Math.min.apply(null, xs);
    var ay = Math.min.apply(null, ys);
    return { x: ax, y: ay, l: Math.max.apply(null, xs) - ax, w: Math.max.apply(null, ys) - ay };
  }

  function stepSurface(item, p) {
    if (!item || item.shape !== 'lshape') return null;
    if (!p.pose || p.pose[8] !== 1) return null;
    var sv = item.shapeValues;
    var r = mapLocalRect(item, p, 0, sv.l, 0, sv.wlow, sv.hlow);
    return { z: p.z + sv.hlow, x: r.x, y: r.y, l: r.l, w: r.w };
  }

  /**
   * 对扣可行判定：
   *   斜顶箱：斜面互补，恒可行
   *   L 形箱：只有台阶对称（|W低 − W高| ≤ 1mm）时两只才能严丝合缝拼成 W×(H低+H高)，
   *           不对称时两只会互相穿插（实测 160/240 重叠近 2 万个采样点）
   */
  function pairFeasible(item) {
    if (!item) return false;
    if (item.shape === 'slope') return true;
    if (item.shape === 'lshape') return Math.abs(item.shapeValues.wlow - item.shapeValues.whigh) <= 1;
    return false;
  }

  /**
   * 一只箱子提供的水平承重面。
   *   - 斜顶箱：斜面不能承重；只有对扣上件（倒放）的顶面是平的，可以承重
   *   - L 形箱：正放时高段顶面（H高）与台阶顶面（H低）都是水平面；侧放/倒放不给承重面（保守）
   *   - 矩形箱：顶面
   */
  function surfacesOf(item, p) {
    if (!item) return [];
    var sv = item.shapeValues;
    var full = { x: p.x, y: p.y, l: p.l, w: p.w };
    if (item.shape === 'slope') {
      if (p.kind === 'pair-upper') return [{ z: p.z + p.h, rect: full }];
      return [];
    }
    if (item.shape === 'lshape') {
      if (p.kind === 'pair-upper-l') return [{ z: p.z + p.h, rect: full }];
      if (!p.pose || p.pose[8] !== 1) return [];
      var tall = mapLocalRect(item, p, 0, sv.l, sv.wlow, sv.w, sv.h);
      var step = mapLocalRect(item, p, 0, sv.l, 0, sv.wlow, sv.hlow);
      return [
        { z: p.z + sv.h, rect: tall },
        { z: p.z + sv.hlow, rect: step }
      ];
    }
    return [{ z: p.z + p.h, rect: full }];
  }

  /** 叠放诊断：这个箱型能不能往上叠，为什么 */
  function stackDiagnosis(item) {
    var sv = item.shapeValues;
    if (item.shape === 'rect') {
      return { code: 'ok', message: '平顶平底，可以正常叠放' };
    }
    if (item.shape === 'slope') {
      return {
        code: 'pair-only',
        message: '顶面是斜面，不能承重：单只只能放一层；开启「可倒放」后一正一倒对扣、顶面变平才能继续叠'
      };
    }
    // lshape
    if (Math.abs(sv.wlow - sv.whigh) <= 1) {
      return {
        code: 'pair-ok',
        message: '台阶对称（W低≈W高），两只一正一倒可拼成矩形，顶面变平后能继续叠'
      };
    }
    var filler = { l: sv.l, w: sv.wlow, h: sv.hhigh - sv.hlow };
    return {
      code: 'notch',
      message: '台阶缺口不承重，平底箱压上去只贴住高段、悬在缺口上，所以同款无法叠放；' +
        '用 ' + S.num(filler.l) + '×' + S.num(filler.w) + '×' + S.num(filler.h) +
        ' 的配套箱把缺口填平后可继续叠',
      filler: filler
    };
  }

  /**
   * 缺口配套箱建议：给「台阶不对称的 L 形」加一个正好填满缺口的配套箱，
   * 重跑一遍看能多装多少 L 形箱。返回 [{skuId, filler, fillerQty, before, after}]
   */
  function suggestFillers(state, pack) {
    var out = [];
    var c = parseContainer(state.container || {});
    (pack.items || []).forEach(function (it) {
      if (!it.stack || it.stack.code !== 'notch' || !it.stack.filler) return;
      var f = it.stack.filler;
      // 解析估算：缺口填平后每层顶面是完整水平面，层高 = H高，可叠 floor(内高 / H高) 层
      var perLayer = Math.max(0, Math.floor((c.innerL + EPS) / it.bbox.l) * Math.floor((c.innerW + EPS) / it.bbox.w));
      var layers = Math.max(0, Math.floor((c.innerH + EPS) / it.shapeValues.hhigh));
      var cap = perLayer * layers;
      var after = Math.min(it.qty, cap);
      if (after > it.loaded) {
        out.push({
          skuId: it.id,
          name: it.name || (it.shapeName + ' #' + (it.index + 1)),
          filler: f,
          fillerQty: after, // 每个 L 箱配一个正好填满缺口的配套箱
          before: it.loaded,
          after: after,
          delta: after - it.loaded,
          layers: layers,
          perLayer: perLayer
        });
      }
    });
    return out;
  }

  /** 台阶不对称的 L 形：有别的箱型能塞缺口，或允许用垫块填平，就能继续往上叠 */
  function notchFillPossible(baseItem, sorted, allowDunnage) {
    if (allowDunnage) return true;
    var sv = baseItem.shapeValues;
    var nh = sv.hhigh - sv.hlow;
    for (var i = 0; i < sorted.length; i++) {
      var o = sorted[i];
      if (o.id === baseItem.id || o.remaining <= 0 || !o.placeable) continue;
      if (o.shape === 'slope') continue;
      var ps = posesFor(o);
      for (var j = 0; j < ps.length; j++) {
        var p = ps[j];
        if (p.thickness <= nh + EPS &&
            ((p.fx <= sv.l + EPS && p.fy <= sv.wlow + EPS) ||
             (p.fx <= sv.wlow + EPS && p.fy <= sv.l + EPS))) {
          return true;
        }
      }
    }
    return false;
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
      item.stack = stackDiagnosis(item);
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
    var dunnageSurfaces = [];
    var z = 0;
    var usedWeight = 0;
    var loadedCount = 0;
    var weightKnown = items.every(function (it) { return it.unitWeight !== null; });
    var stop = { code: 'all-loaded', message: '全部装载完成' };

    // 支撑索引：key 为水平面高度，值为该高度上可以承重的矩形
    var topIndex = {};
    var itemsById = {};
    items.forEach(function (it) { itemsById[it.id] = it; });

    function keyOf(h) { return Math.round(h * 1000); }

    function addSurface(z, rect) {
      var k = keyOf(z);
      (topIndex[k] = topIndex[k] || []).push(rect);
    }

    function addSupport(p) {
      var it = itemsById[p.skuId];
      surfacesOf(it, p).forEach(function (s) {
        addSurface(s.z, s.rect);
      });
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
      var slopeFallback = null;
      for (var i = 0; i < sorted.length; i++) {
        var it = sorted[i];
        if (it.remaining <= 0 || !it.placeable) continue;
        var pose = bestPose(it, c, c.innerH - z);
        if (!pose) continue;
        // 斜顶单只、以及不可对扣的 L 形：顶面不是完整水平面，一旦放上去就不能再叠，
        // 所以让它们排在最后当顶层的备选，先把高度让给能叠的箱型。
        var topOnly = (it.shape === 'slope' && !(it.allowFlip && pairFeasible(it) && it.remaining >= 2)) ||
          (it.shape === 'lshape' && !(it.allowFlip && pairFeasible(it) && it.remaining >= 2) &&
            !notchFillPossible(it, sorted, opts.allowDunnage));
        if (topOnly) {
          if (!slopeFallback) slopeFallback = { item: it, pose: pose };
          continue;
        }
        cand = it;
        candPose = pose;
        break;
      }
      if (!cand && slopeFallback) {
        cand = slopeFallback.item;
        candPose = slopeFallback.pose;
      }
      if (!cand) {
        var anyPlaceable = sorted.some(function (x) { return x.remaining > 0 && x.placeable; });
        stop = anyPlaceable
          ? { code: 'height', message: '剩余高度 ' + S.num(Math.max(0, c.innerH - z)) + ' mm，放不下任何剩余箱型' }
          : { code: 'all-loaded', message: '全部装载完成' };
        break;
      }

      var posCap = capacityOf(candPose, c);

      // 对扣：一正一倒，每对占 H低+H高；底件固定用「正放」，和最优单层方案比总箱数。
      // 斜顶恒可行；L 形只有台阶对称才可行，不对称直接不参与对扣（退回单放 + 缺口嵌合）。
      var pair = null;
      if (cand.allowFlip && pairFeasible(cand)) {
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
                pairsPerLayer: pairsPerLayer,
                offset: sv.hlow,
                upperKind: cand.shape === 'lshape' ? 'pair-upper-l' : 'pair-upper'
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
              x: px, y: py, z: layerZ + pair.offset,
              l: pair.upper.fx, w: pair.upper.fy, h: pair.upper.thickness,
              rot: 90, layer: layerIndex, pose: pair.upper.m, kind: pair.upperKind
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

      // L 形缺口嵌合：低段台阶顶面是水平面，可以在缺口里塞别的小箱（这才是 L 形省空间的正确用法）
      if (!pair && cand.shape === 'lshape') {
        var svL = cand.shapeValues;
        var stepZ = layerZ + svL.hlow;
        var sRects = [];
        placements.forEach(function (q) {
          if (q.layer !== layerIndex) return;
          var st = stepSurface(cand, q);
          if (st) sRects.push(st);
        });
        if (sRects.length) {
          var nx0 = Infinity, nx1 = -Infinity, ny0 = Infinity, ny1 = -Infinity;
          sRects.forEach(function (r) {
            nx0 = Math.min(nx0, r.x); nx1 = Math.max(nx1, r.x + r.l);
            ny0 = Math.min(ny0, r.y); ny1 = Math.max(ny1, r.y + r.w);
          });
          var notch = { x: nx0, y: ny0, l: nx1 - nx0, w: ny1 - ny0 };
          var notchH = svL.hhigh - svL.hlow;
          var nf = pickFiller(notch, notchH, stepZ, cand, items, sorted, c, weightKnown, usedWeight);
          if (nf) {
            var nMax = Math.min(nf.cap.cap, nf.item.remaining);
            if (weightKnown && nf.item.unitWeight > 0) {
              nMax = Math.min(nMax, Math.floor((c.payload - usedWeight) / nf.item.unitWeight));
            }
            var nPlaced = 0;
            for (var nr = 0; nr < nf.cap.ny && nPlaced < nMax; nr++) {
              for (var nc = 0; nc < nf.cap.nx && nPlaced < nMax; nc++) {
                var gx = notch.x + nc * nf.pose.fx;
                var gy = notch.y + nr * nf.pose.fy;
                if (gx + nf.pose.fx > notch.x + notch.l + EPS) continue;
                if (gy + nf.pose.fy > notch.y + notch.w + EPS) continue;
                if (!supportedAt(gx, gy, nf.pose.fx, nf.pose.fy, stepZ)) continue;
                var np = {
                  skuId: nf.item.id, index: items.indexOf(nf.item),
                  col: nc + 1, row: nr + 1,
                  x: gx, y: gy, z: stepZ, l: nf.pose.fx, w: nf.pose.fy, h: nf.pose.thickness,
                  rot: 0, layer: layerIndex, pose: nf.pose.m, kind: 'notch'
                };
                placements.push(np);
                addSupport(np);
                nPlaced++;
                nf.item.loaded++;
                nf.item.remaining--;
                loadedCount++;
                fillTotal++;
                usedWeight += (nf.item.unitWeight || 0);
              }
            }
            if (nPlaced > 0) {
              layerFill.push({ skuId: nf.item.id, name: nf.item.name, count: nPlaced, notch: true });
            }
          }
        }
      }

      // 垫块填平：缺口没有真实小箱可填时，用垫块把台阶缺口垫到 H高（装柜常规做法，不增加货量）
      var layerDunnage = 0;
      if (!pair && cand.shape === 'lshape' && opts.allowDunnage) {
        var svD = cand.shapeValues;
        var topZ = layerZ + svD.hhigh;
        placements.forEach(function (q) {
          if (q.layer !== layerIndex) return;
          var stq = stepSurface(cand, q);
          if (!stq) return;
          if (supportedAt(stq.x, stq.y, stq.l, stq.w, topZ)) return;
          addSurface(topZ, { x: stq.x, y: stq.y, l: stq.l, w: stq.w });
          dunnageSurfaces.push({ z: topZ, rect: { x: stq.x, y: stq.y, l: stq.l, w: stq.w } });
          layerDunnage++;
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
        dunnage: layerDunnage,
        pose: pair ? null : candPose.m
      });

      z = layerTop;

      // 斜顶单只顶部是斜面，不能承重：这一层必须是最后一层
      if (!pair && cand.shape === 'slope') {
        stop = { code: 'slope-top', message: '斜顶箱单只顶部是斜面，不能再往上叠（已按最高层计算）' };
        break;
      }

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
      dunnageSurfaces: dunnageSurfaces,
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
      // 斜顶箱的顶面是斜面（或需要靠配对才能变平），不能当填缝件——上面再压箱就不合法
      if (it.shape === 'slope') continue;
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

  /**
   * 物理校验（每条都有对应的反向用例在测试里）：
   *   1. 每箱下方必须被同高度的水平面完整覆盖（斜面、台阶竖面不算）
   *   2. 斜顶单只上方不得压任何箱
   *   3. 对扣必须有下件、贴合误差 ≤ 1mm、上件必须是倒放
   * 返回错误数组，空数组 = 通过。
   */
  function validatePhysics(pack) {
    var errs = [];
    var itemsById = {};
    (pack.items || []).forEach(function (it) { itemsById[it.id] = it; });
    var surface = {};
    function key(h) { return Math.round(h * 1000); }
    function pushSurface(z, r) {
      var k = key(z);
      (surface[k] = surface[k] || []).push(r);
    }

    (pack.placements || []).forEach(function (p) {
      surfacesOf(itemsById[p.skuId], p).forEach(function (s) {
        var k = key(s.z);
        (surface[k] = surface[k] || []).push(s.rect);
      });
    });
    // 垫块同样提供水平承重面（不增加货量，但是真实装柜里填平缺口的做法）
    (pack.dunnageSurfaces || []).forEach(function (s) {
      var k = key(s.z);
      (surface[k] = surface[k] || []).push(s.rect);
    });

    // 1. 支撑（对扣上件由下件贴合支撑，单独在第 3 条校验）
    (pack.placements || []).forEach(function (p) {
      if (p.z <= EPS) return;
      if (p.kind === 'pair-upper' || p.kind === 'pair-upper-l') return;
      var rects = surface[key(p.z)] || [];
      if (!covers({ x: p.x, y: p.y, l: p.l, w: p.w }, rects)) {
        errs.push({ code: 'floating', message: '箱体悬空：底部无完整支撑面', placement: p });
      }
    });

    // 2. 斜顶单只上方不得有箱
    (pack.placements || []).forEach(function (p) {
      var it = itemsById[p.skuId];
      if (!it || it.shape !== 'slope') return;
      if (p.kind === 'pair-lower' || p.kind === 'pair-upper') return;
      (pack.placements || []).forEach(function (q) {
        if (q === p) return;
        if (q.z < p.z + p.h - EPS) return;
        if (q.x < p.x + p.l - EPS && q.x + q.l > p.x + EPS &&
            q.y < p.y + p.w - EPS && q.y + q.w > p.y + EPS) {
          errs.push({ code: 'slope-top-loaded', message: '斜顶箱单只上方压了箱子', placement: p, by: q });
        }
      });
    });

    // 3. 对扣贴合
    var lowers = {};
    var uppers = {};
    (pack.placements || []).forEach(function (p) {
      var k = p.layer + '|' + p.x + '|' + p.y;
      if (p.kind === 'pair-lower') lowers[k] = p;
      if (p.kind === 'pair-upper' || p.kind === 'pair-upper-l') uppers[k] = p;
    });
    Object.keys(uppers).forEach(function (k) {
      var u = uppers[k];
      var l = lowers[k];
      var it = itemsById[u.skuId];
      if (!l) {
        errs.push({ code: 'pair-without-lower', message: '对扣上件没有下件', placement: u });
        return;
      }
      var offset = it && it.shapeValues ? it.shapeValues.hlow : 0;
      if (Math.abs(u.z - (l.z + offset)) > 1) {
        errs.push({ code: 'pair-gap', message: '对扣接触面错位 ' + S.num(Math.abs(u.z - (l.z + offset))) + ' mm', placement: u });
      }
      if (!u.pose || u.pose[8] !== -1) {
        errs.push({ code: 'pair-not-flipped', message: '对扣上件不是倒放', placement: u });
      }
      if (it && it.shape === 'lshape' && Math.abs(it.shapeValues.wlow - it.shapeValues.whigh) > 1) {
        errs.push({ code: 'pair-asymmetric-l', message: '不对称 L 形不允许对扣', placement: u });
      }
    });

    return errs;
  }

  NS.pack = {
    run: run,
    extraContainers: extraContainers,
    suggestFillers: suggestFillers,
    stackDiagnosis: stackDiagnosis,
    validatePhysics: validatePhysics,
    stepSurface: stepSurface,
    pairFeasible: pairFeasible,
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
