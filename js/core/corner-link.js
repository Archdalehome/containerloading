/*
 * 角点对位（corner link）：两只箱子各点一个角，让这两个点严格重合。
 *
 * 为什么不用"靠近就自动吸附"：自动吸附按整只箱子的最近距离猜，尺寸不同时经常猜错，
 * 而且用户没法确知它会吸到哪个角。点两个角是明确的指令——我要这个角落在这个位置上，
 * 和现场堆箱"看准两个角再往里推"是同一个动作。
 *
 * 纯逻辑：不碰 DOM/3D。坐标一律 mm，容器内坐标（x 沿柜长、y 沿柜宽、z 向上）。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.manual && typeof require === 'function') NS.manual = require('./manual.js');
  if (!NS.pack && typeof require === 'function') NS.pack = require('./pack.js');
  var M = NS.manual;
  var P = NS.pack;
  var EPS = 1e-6;
  var SUPPORT_TOL = 20;    // 与 manual.js 同一口径：允许 20mm 悬挑
  var SUPPORT_MIN = 0.1;   // 与 manual.js 同一口径：接触 ≥10% 底面即可叠

  function r1(v) { return Math.round(v * 10) / 10; }

  /**
   * 一只箱子的可点角点（mm，容器坐标）。两类：
   *   bbox —— 外接长方体 8 个角，任何箱型都有；
   *   face —— 真实顶面矩形的角（pack.surfacesOf）。L 形箱因此多出低段台阶的 4 个角，
   *           这正是"把箱子倒扣进缺口、落在台阶上"要瞄的那个角。
   * 斜顶箱顶面不承重、surfacesOf 为空，暂时只有 8 个 bbox 角。
   */
  function cornersOf(box, item) {
    var out = [];
    for (var ix = 0; ix < 2; ix++) {
      for (var iy = 0; iy < 2; iy++) {
        for (var iz = 0; iz < 2; iz++) {
          out.push({
            key: 'b' + ix + iy + iz, kind: 'bbox',
            ix: ix, iy: iy, iz: iz,
            x: box.x + ix * box.l,
            y: box.y + iy * box.w,
            z: box.z + iz * box.h,
            isBottom: iz === 0
          });
        }
      }
    }
    if (item && P && P.surfacesOf) {
      var seen = {};
      out.forEach(function (q) { seen[r1(q.x) + ',' + r1(q.y) + ',' + r1(q.z)] = true; });
      P.surfacesOf(item, box).forEach(function (s) {
        var rect = s.rect;
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (c, i) {
          var q = {
            key: 'f' + out.length + '_' + i, kind: 'face',
            x: rect.x + c[0] * rect.l,
            y: rect.y + c[1] * rect.w,
            z: s.z,
            isBottom: s.z <= box.z + 1
          };
          var k = r1(q.x) + ',' + r1(q.y) + ',' + r1(q.z);
          if (seen[k]) return;      // 与 bbox 角重合的不重复显示
          seen[k] = true;
          out.push(q);
        });
      });
    }
    return out;
  }

  /** 下方（z 高度处）能托住底面的接触面积，口径与 manual.js 的 settle 一致 */
  function contactAt(box, placed, itemsById) {
    if (box.z <= EPS) return { area: box.l * box.w, level: 0, floor: true };
    var byZ = {};
    (placed || []).forEach(function (p) {
      var it = itemsById && itemsById[p.skuId];
      if (!it || !P || !P.surfacesOf) return;
      P.surfacesOf(it, p).forEach(function (s) {
        if (Math.abs(s.z - box.z) > 1) return;         // 只认箱底所在这一层
        var k = Math.round(s.z * 1000) / 1000;
        (byZ[k] = byZ[k] || []).push({
          x: s.rect.x - SUPPORT_TOL, y: s.rect.y - SUPPORT_TOL,
          l: s.rect.l + SUPPORT_TOL * 2, w: s.rect.w + SUPPORT_TOL * 2
        });
      });
    });
    var best = 0, lvl = null;
    Object.keys(byZ).forEach(function (k) {
      byZ[k].forEach(function (r) {
        var ix = Math.min(box.x + box.l, r.x + r.l) - Math.max(box.x, r.x);
        var iy = Math.min(box.y + box.w, r.y + r.w) - Math.max(box.y, r.y);
        if (ix > 0 && iy > 0) { var a = ix * iy; if (a > best) { best = a; lvl = Number(k); } }
      });
    });
    return { area: best, level: lvl, floor: false };
  }

  /**
   * 让 moving 上的 mp 点与 target 上的 tp 点重合（两点都是容器坐标的绝对点）。
   * 只平移、不自作主张往下落：一落就不是"这两个点重合"了。落不下去就说原因。
   *
   * 返回的 residual 是**复核值**——把移动后的箱子按同样偏移重新算一遍，
   * 三个数必须都是 0，界面上直接显示，不靠眼睛判断。
   */
  function link(moving, mp, target, tp, placed, c, itemsById) {
    if (!mp || !tp) return { ok: false, reason: 'bad-point', message: '没有取到角点坐标' };
    var ox = mp.x - moving.x, oy = mp.y - moving.y, oz = mp.z - moving.z;  // 被点那个角相对箱原点的偏移
    var dx = tp.x - mp.x, dy = tp.y - mp.y, dz = tp.z - mp.z;
    var cand = Object.assign({}, moving, {
      x: moving.x + dx, y: moving.y + dy, z: moving.z + dz
    });

    if (cand.h > c.doorH + EPS) {
      return { ok: false, reason: 'door-height', message: '箱高 ' + Math.round(cand.h) + 'mm 超过柜门 ' + c.doorH + 'mm', delta: { dx: dx, dy: dy, dz: dz }, box: cand };
    }
    if (cand.x < -EPS || cand.y < -EPS || cand.z < -EPS ||
        cand.x + cand.l > c.innerL + EPS || cand.y + cand.w > c.innerW + EPS ||
        cand.z + cand.h > c.innerH + EPS) {
      return { ok: false, reason: 'bounds', message: '对角后超出柜内腔', delta: { dx: dx, dy: dy, dz: dz }, box: cand };
    }
    var others = (placed || []).filter(function (o) { return o.uid !== moving.uid; });
    for (var i = 0; i < others.length; i++) {
      if (M.overlaps(cand, others[i], itemsById)) {
        return { ok: false, reason: 'overlap', message: '对角后与已有箱体重叠', delta: { dx: dx, dy: dy, dz: dz }, box: cand, with: others[i] };
      }
    }
    var ct = contactAt(cand, others, itemsById);
    if (ct.area < cand.l * cand.w * SUPPORT_MIN) {
      return {
        ok: false, reason: 'no-support',
        message: '两只角对上了，但 z=' + Math.round(cand.z) + 'mm 这一层下方只托住 ' +
          Math.round(ct.area) + 'mm²（底面 ' + Math.round(cand.l * cand.w) + 'mm²），会悬空',
        delta: { dx: dx, dy: dy, dz: dz }, box: cand
      };
    }
    return {
      ok: true, box: cand, delta: { dx: dx, dy: dy, dz: dz },
      contact: { area: Math.round(ct.area), ratio: Math.round(ct.area / (cand.l * cand.w) * 1000) / 1000, floor: ct.floor },
      residual: {
        dx: r1((cand.x + ox) - tp.x),
        dy: r1((cand.y + oy) - tp.y),
        dz: r1((cand.z + oz) - tp.z)
      }
    };
  }

  /**
   * 松手时自动对齐某个角：在 tol 范围内找最近的一对"本箱底角 ↔ 别箱角（或柜角）"，
   * 把两个点精确重合，再用 link() 过一遍重叠/支撑/越界。
   * 找不到、或对齐后过不了校验，就返回 ok:false，调用方退回普通落位。
   */
  function alignOnDrop(box, placed, c, itemsById, opts) {
    var tol = (opts && opts.tol !== undefined) ? opts.tol : 150;
    var item = itemsById && itemsById[box.skuId];
    var mine = cornersOf(box, item).filter(function (q) { return q.isBottom; });
    var targets = [];
    (placed || []).forEach(function (o) {
      if (o.uid === box.uid) return;
      cornersOf(o, itemsById && itemsById[o.skuId]).forEach(function (q) {
        targets.push({ box: o, q: q });
      });
    });
    // 柜底四角也算目标：贴柜角是最常见的对齐
    [[0, 0], [c.innerL, 0], [0, c.innerW], [c.innerL, c.innerW]].forEach(function (p) {
      targets.push({ floor: true, q: { key: 'floor', x: p[0], y: p[1], z: 0 } });
    });
    var pairs = [];
    mine.forEach(function (m) {
      targets.forEach(function (t) {
        var d = Math.sqrt(Math.pow(t.q.x - m.x, 2) + Math.pow(t.q.y - m.y, 2) + Math.pow(t.q.z - m.z, 2));
        if (d <= tol) pairs.push({ m: m, t: t, d: d });
      });
    });
    pairs.sort(function (a, b) { return a.d - b.d; });
    for (var i = 0; i < pairs.length; i++) {
      var pr = pairs[i];
      var tgt = pr.t.box || { x: 0, y: 0, z: 0, uid: '__floor' };
      var r = link(box, pr.m, tgt, pr.t.q, placed, c, itemsById);
      if (!r.ok) continue;
      return Object.assign({}, r, {
        alignedWith: pr.t.floor ? 'floor' : pr.t.box.uid,
        movingKey: pr.m.key,
        targetKey: pr.t.q.key,
        dist: Math.round(pr.d * 10) / 10
      });
    }
    return { ok: false, reason: 'no-align', message: '附近 ' + tol + 'mm 内没有可对齐的角' };
  }

  /** 所有可承重的水平面（含柜底 z=0），按高度从高到低 */
  function levelsDown(placed, itemsById, c) {
    var byZ = {};
    (placed || []).forEach(function (p) {
      var it = itemsById && itemsById[p.skuId];
      if (!it || !P || !P.surfacesOf) return;
      P.surfacesOf(it, p).forEach(function (s) {
        if (s.z <= 0) return;
        var k = Math.round(s.z * 1000) / 1000;
        (byZ[k] = byZ[k] || []).push({ x: s.rect.x, y: s.rect.y, l: s.rect.l, w: s.rect.w, owner: p.uid });
      });
    });
    byZ[0] = [{ x: 0, y: 0, l: c.innerL, w: c.innerW, owner: 'floor' }];
    return Object.keys(byZ).map(Number).sort(function (a, b) { return b - a; })
      .map(function (z) { return { z: z, rects: byZ[z] }; });
  }

  /**
   * 贴面落位：先落到"脚下最高的、真的托得住底面的那一层"，再在这一层里把底面的某个角
   * 对到支撑面的角上（tol 内），最后验零侵入。
   *
   * 为什么要有这一步：只做"沉降"能保证高度对、但水平位置可能差几十毫米；
   * 只做"角对齐"又可能落到一个并不在脚下的角上，出现悬空或缝。两步合起来才是
   * 现场的动作——先坐到面上，再推着贴齐一个角。
   */
  function placeOnFace(box, placed, c, itemsById, opts) {
    var tol = (opts && opts.tol !== undefined) ? opts.tol : 150;
    if (box.h > c.doorH + EPS) {
      return { ok: false, reason: 'door-height', message: '箱高 ' + Math.round(box.h) + 'mm 超过柜门 ' + c.doorH + 'mm' };
    }
    var others = (placed || []).filter(function (o) { return o.uid !== box.uid; });
    var levels = levelsDown(others, itemsById, c);
    var foot = { x: box.x, y: box.y, l: box.l, w: box.w };
    var pick = null;
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      if (lv.z + box.h > c.innerH + EPS) continue;
      var bestRect = null, bestArea = 0;
      lv.rects.forEach(function (r) {
        var ix = Math.min(foot.x + foot.l, r.x + r.l) - Math.max(foot.x, r.x);
        var iy = Math.min(foot.y + foot.w, r.y + r.w) - Math.max(foot.y, r.y);
        if (ix <= 0 || iy <= 0) return;
        var a = ix * iy;
        if (a > bestArea) { bestArea = a; bestRect = r; }
      });
      if (bestArea >= foot.l * foot.w * SUPPORT_MIN) { pick = { z: lv.z, rect: bestRect, area: bestArea }; break; }
    }
    if (!pick) {
      return { ok: false, reason: 'no-support', message: '脚下没有能托住 ' + Math.round(box.l) + '×' + Math.round(box.w) + 'mm 底面的平面' };
    }
    var cand = Object.assign({}, box, { z: pick.z });
    // 逐轴找边对齐：x、y 各自独立，取"位移最小"的那条边；箱型/尺寸不同也照样能用。
    // 一个轴上一个候选都没有时（比如落在很大的柜底上），退而贴支撑面最近的边，
    // 保证落点永远是确定的，不会停在"差几十毫米"的含糊位置。
    function edgeCandidates(axis, cur, size, rect) {
      var out = [];
      var lo = axis === 'x' ? c.innerL : c.innerW;
      out.push({ d: 0 - cur, tag: '柜壁0' });
      out.push({ d: (lo - size) - cur, tag: '柜壁max' });
      if (rect) {
        var r0 = axis === 'x' ? rect.x : rect.y;
        var r1 = r0 + (axis === 'x' ? rect.l : rect.w);
        out.push({ d: r0 - cur, tag: '支撑面-' });
        out.push({ d: r1 - size - cur, tag: '支撑面+' });
        out.push({ d: r1 - cur, tag: '支撑面右缘对左缘' });
        out.push({ d: r0 - (cur + size), tag: '支撑面左缘对右缘' });
      }
      others.forEach(function (o) {
        var o0 = axis === 'x' ? o.x : o.y;
        var o1 = o0 + (axis === 'x' ? o.l : o.w);
        var tag = '#' + o.uid;
        out.push({ d: o0 - cur, tag: tag + ' 齐左' });
        out.push({ d: o1 - size - cur, tag: tag + ' 齐右' });
        out.push({ d: o1 - cur, tag: tag + ' 右缘接左缘' });
        out.push({ d: o0 - (cur + size), tag: tag + ' 左缘接右缘' });
      });
      return out;
    }
    function pickEdge(axis, cur, size, rect) {
      var cands = edgeCandidates(axis, cur, size, rect);
      var bestC = null;
      cands.forEach(function (k) {
        if (!bestC || Math.abs(k.d) < Math.abs(bestC.d)) bestC = k;
      });
      return bestC;
    }
    var ex = pickEdge('x', cand.x, cand.l, pick.rect);
    var ey = pickEdge('y', cand.y, cand.w, pick.rect);
    var aligned = { dx: 0, dy: 0, moved: false, x: null, y: null };
    if (ex && Math.abs(ex.d) <= tol) { cand.x += ex.d; aligned.dx = r1(ex.d); aligned.x = ex.tag; }
    if (ey && Math.abs(ey.d) <= tol) { cand.y += ey.d; aligned.dy = r1(ey.d); aligned.y = ey.tag; }
    // 没有近的边 → 直接贴支撑面最近的一条边（不是柜底时），落点仍然确定
    if (pick.rect && pick.rect.owner !== 'floor') {
      if (!aligned.x) {
        var r0x = pick.rect.x, r1x = r0x + pick.rect.l;
        var dLeft = r0x - cand.x, dRight = (r1x - cand.l) - cand.x;
        if (Math.abs(dLeft) <= Math.abs(dRight)) { cand.x += dLeft; aligned.dx = r1(dLeft); aligned.x = '贴支撑面左缘'; }
        else { cand.x += dRight; aligned.dx = r1(dRight); aligned.x = '贴支撑面右缘'; }
      }
      if (!aligned.y) {
        var r0y = pick.rect.y, r1y = r0y + pick.rect.w;
        var dLo = r0y - cand.y, dHi = (r1y - cand.w) - cand.y;
        if (Math.abs(dLo) <= Math.abs(dHi)) { cand.y += dLo; aligned.dy = r1(dLo); aligned.y = '贴支撑面前缘'; }
        else { cand.y += dHi; aligned.dy = r1(dHi); aligned.y = '贴支撑面后缘'; }
      }
    }
    aligned.moved = !!(aligned.x || aligned.y);
    if (cand.x < -EPS || cand.y < -EPS ||
        cand.x + cand.l > c.innerL + EPS || cand.y + cand.w > c.innerW + EPS) {
      return { ok: false, reason: 'bounds', message: '对齐后超出柜内腔', box: cand };
    }
    for (var j = 0; j < others.length; j++) {
      if (M.overlaps(cand, others[j], itemsById)) {
        return { ok: false, reason: 'overlap', message: '与 #' + others[j].uid + ' 互相侵入', box: cand, with: others[j] };
      }
    }
    // 复核面接触：这一层真正接触到的面积占比
    var ct = contactAt(cand, others, itemsById);
    return {
      ok: true, box: cand,
      floor: pick.z <= EPS,
      supportZ: pick.z,
      contact: {
        area: Math.round(ct.area),
        ratio: Math.round(ct.area / (cand.l * cand.w) * 1000) / 1000,
        floor: ct.floor
      },
      aligned: aligned,
      gap: r1(cand.z - pick.z)          // 必须为 0：说明"坐在面上"，不是浮着
    };
  }

  /* ---------- 对扣：翻转姿态与落点由几何定，不靠人摆 ---------- */

  var IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // 翻转轴按箱型分开（用 solid 采样量出来的）：
  //   L 形沿宽度镜像 + 翻 z；斜顶沿长度镜像 + 翻 z
  var FLIP = {
    lshape: [1, 0, 0, 0, -1, 0, 0, 0, -1],
    slope: [-1, 0, 0, 0, 1, 0, 0, 0, -1]
  };

  function mul3(a, b) {
    var o = new Array(9);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
      }
    }
    return o;
  }

  /**
   * 配对件（倒扣件）的位置与姿态：x/y 与下件完全相同 → 四个角严格重合；
   * z 抬 H低（L 形）/ H底（斜顶）→ 缺口正好扣住下件的凸起，两块互补成实心块。
   */
  function pairPlacement(lower, item) {
    if (!item || !item.shapeValues) return null;
    var flip = FLIP[item.shape];
    if (!flip) return null;                       // 矩形箱不需要对扣
    var sv = item.shapeValues;
    return {
      x: lower.x, y: lower.y, z: lower.z + sv.hlow,
      l: lower.l, w: lower.w, h: lower.h,
      pose: mul3(flip, lower.pose || IDENT)
    };
  }

  function sameShape(a, b) {
    if (!a || !b || a.shape !== b.shape) return false;
    var x = a.shapeValues || {}, y = b.shapeValues || {};
    var keys = ['l', 'w', 'wlow', 'whigh', 'hlow', 'hhigh'];
    for (var i = 0; i < keys.length; i++) {
      if (Math.abs((x[keys[i]] || 0) - (y[keys[i]] || 0)) > 1) return false;
    }
    return true;
  }

  /**
   * 拖到附近就自动对扣：找同箱型、且本箱落在它水平 tol 范围内的下件，
   * 算出配对件的姿态与落点（角已对齐），逐只采样验零侵入，通过就返回。
   * 这是"现场把箱子翻过来扣上去"那一下，不需要人手对齐。
   */
  function autoPairOnDrop(box, placed, c, itemsById, opts) {
    var tol = (opts && opts.tol !== undefined) ? opts.tol : 400;
    var item = itemsById && itemsById[box.skuId];
    if (!item || !FLIP[item.shape]) return { ok: false, reason: 'no-pair-shape', message: '这个箱型不需要对扣' };
    var best = null;
    (placed || []).forEach(function (o) {
      if (o.uid === box.uid) return;
      var oi = itemsById && itemsById[o.skuId];
      if (!sameShape(item, oi)) return;          // 只和同款箱对扣：不同尺寸扣不严
      if (o.paired) return;                      // 已经配过对的别再叠一层
      var t = pairPlacement(o, item);
      if (!t) return;
      var d = Math.sqrt(Math.pow(t.x - box.x, 2) + Math.pow(t.y - box.y, 2));
      if (d > tol) return;
      var cand = Object.assign({}, box, t, { uid: box.uid });
      if (cand.h > c.doorH + EPS) return;
      if (cand.x < -EPS || cand.y < -EPS ||
          cand.x + cand.l > c.innerL + EPS || cand.y + cand.w > c.innerW + EPS ||
          cand.z + cand.h > c.innerH + EPS) return;
      var bad = false;
      (placed || []).forEach(function (p) {
        if (bad || p.uid === box.uid) return;
        if (M.overlaps(cand, p, itemsById)) bad = true;
      });
      if (bad) return;
      if (!best || d < best.dist) best = { box: cand, lower: o, dist: Math.round(d * 10) / 10 };
    });
    if (!best) return { ok: false, reason: 'no-pair', message: '附近 ' + tol + 'mm 内没有可对扣的同款箱' };
    return {
      ok: true,
      box: best.box,
      pairedWith: best.lower.uid,
      dist: best.dist,
      // 角对齐是构造出来的：x/y 与下件完全相同
      residual: {
        dx: r1(best.box.x - best.lower.x),
        dy: r1(best.box.y - best.lower.y),
        dz: r1(best.box.z - (best.lower.z + (item.shapeValues.hlow)))
      }
    };
  }

  NS.cornerLink = {
    cornersOf: cornersOf,
    contactAt: contactAt,
    link: link,
    alignOnDrop: alignOnDrop,
    placeOnFace: placeOnFace,
    pairPlacement: pairPlacement,
    autoPairOnDrop: autoPairOnDrop
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.cornerLink;
})(typeof globalThis !== 'undefined' ? globalThis : this);
