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

  NS.cornerLink = {
    cornersOf: cornersOf,
    contactAt: contactAt,
    link: link,
    alignOnDrop: alignOnDrop
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.cornerLink;
})(typeof globalThis !== 'undefined' ? globalThis : this);
