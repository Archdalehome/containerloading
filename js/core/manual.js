/*
 * 手动装柜的逻辑层：沉降、贴齐、拒绝落位、旋转。
 * 不做 DOM、不碰 3D，浏览器与 Node 都能跑（3D 拖动只负责把坐标喂进来）。
 *
 * 口径与自动模式一致：占位一律用外接长方体（mm），支撑按真实接触面（P.surfacesOf）。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.pack && typeof require === 'function') NS.pack = require('./pack.js');
  var P = NS.pack;
  var EPS = 1e-6;

  function overlapsXY(a, b) {
    return a.x < b.x + b.l - EPS && b.x < a.x + a.l - EPS &&
      a.y < b.y + b.w - EPS && b.y < a.y + a.w - EPS;
  }

  function overlaps(a, b) {
    return overlapsXY(a, b) && a.z < b.z + b.h - EPS && b.z < a.z + a.h - EPS;
  }

  function inBounds(box, c) {
    return box.x >= -EPS && box.y >= -EPS && box.z >= -EPS &&
      box.x + box.l <= c.innerL + EPS &&
      box.y + box.w <= c.innerW + EPS &&
      box.z + box.h <= c.innerH + EPS &&
      box.h <= c.doorH + EPS; // 门高是硬约束
  }

  /** 每一层的承重面（真实接触面，单位 mm） */
  function levelsOf(placed, itemsById) {
    var levels = { 0: [] };
    placed.forEach(function (p) {
      var it = itemsById[p.skuId];
      if (!it || !P.surfacesOf) return;
      P.surfacesOf(it, p).forEach(function (s) {
        var k = Math.round(s.z * 1000) / 1000;
        (levels[k] = levels[k] || []).push(s.rect);
      });
    });
    return levels;
  }

  /**
   * 沉降：落到正下方「能完整托住底面」的最高水平面。
   * 返回 { z, ok }；ok=false 表示下方没有任何面能完整托住（悬空）。
   */
  function settle(box, placed, c, itemsById) {
    var foot = { x: box.x, y: box.y, l: box.l, w: box.w };
    var levels = levelsOf(placed, itemsById || {});
    var keys = Object.keys(levels).map(Number)
      .filter(function (k) { return k <= box.z + EPS && k + box.h <= c.innerH + EPS; })
      .sort(function (a, b) { return b - a; });
    for (var i = 0; i < keys.length; i++) {
      if (Math.abs(keys[i]) < EPS) {
        // 柜底：铺满整个内腔
        if (box.x >= -EPS && box.y >= -EPS && box.x + box.l <= c.innerL + EPS && box.y + box.w <= c.innerW + EPS) {
          return { z: 0, ok: true };
        }
        continue;
      }
      if (P.covers(foot, levels[keys[i]])) return { z: keys[i], ok: true };
    }
    return { z: box.z, ok: false };
  }

  /**
   * 贴齐：在 tol 内往最近的柜壁或相邻箱面靠。
   * 只动水平方向；贴完仍要能完整支撑（由调用方再 settle 一次）。
   */
  function snap(box, placed, c, tol) {
    var t = tol === undefined ? 50 : tol;
    var snaps = [];
    function nearest(cur, cands, axis) {
      var best = null;
      for (var i = 0; i < cands.length; i++) {
        var d = cands[i] - cur;
        if (Math.abs(d) <= t && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
      return best;
    }
    var xs = [0, c.innerL - box.l];
    var ys = [0, c.innerW - box.w];
    placed.forEach(function (p) {
      xs.push(p.x, p.x + p.l, p.x - box.l, p.x + p.l - box.l);
      ys.push(p.y, p.y + p.w, p.y - box.w, p.y + p.w - box.w);
    });
    var dx = nearest(box.x, xs, 'x');
    var dy = nearest(box.y, ys, 'y');
    var out = Object.assign({}, box);
    if (dx !== null) { out.x = Math.round((box.x + dx) * 1000) / 1000; snaps.push({ axis: 'x', delta: dx, kind: out.x <= EPS ? 'wall' : 'face' }); }
    if (dy !== null) { out.y = Math.round((box.y + dy) * 1000) / 1000; snaps.push({ axis: 'y', delta: dy, kind: out.y <= EPS ? 'wall' : 'face' }); }
    return { box: out, snaps: snaps };
  }

  /**
   * 落位一次：射线给的 (x, y, z) → 贴齐 → 沉降 → 判定。
   * 判定顺序与 Chief 定的一致：先贴齐再沉降，最后查越界/重叠；不合法原样返回原因。
   */
  function tryPlace(input, placed, c, itemsById, opts) {
    var tol = (opts && opts.tol !== undefined) ? opts.tol : 50;
    var snapped = snap(input, placed, c, tol);
    var box = snapped.box;
    // 先查水平越界：贴齐之后若已经出界，直接按「越界」报，不要绕到「无支撑」上去
    if (box.x < -EPS || box.y < -EPS ||
        box.x + box.l > c.innerL + EPS || box.y + box.w > c.innerW + EPS) {
      return { ok: false, reason: 'bounds', message: '超出柜内腔（水平方向）', box: box };
    }
    var st = settle(box, placed, c, itemsById);
    box.z = st.z;
    if (!st.ok) {
      return { ok: false, reason: 'no-support', message: '下方没有能完整托住底面的箱面', box: box };
    }
    if (!inBounds(box, c)) {
      return { ok: false, reason: 'bounds', message: '超出柜内腔或门高', box: box };
    }
    for (var i = 0; i < placed.length; i++) {
      if (overlaps(box, placed[i])) {
        return { ok: false, reason: 'overlap', message: '与已有箱体重叠', box: box, with: placed[i] };
      }
    }
    return { ok: true, box: box, snaps: snapped.snaps };
  }

  /* 三轴各 90°：只改外廓尺寸，姿态矩阵交给 3D 层（与自动模式同一套） */
  function rotate90(box, axis) {
    var out = Object.assign({}, box);
    if (axis === 'x') { var t1 = out.w; out.w = out.h; out.h = t1; }
    else if (axis === 'y') { var t2 = out.l; out.l = out.h; out.h = t2; }
    else { var t3 = out.l; out.l = out.w; out.w = t3; }
    return out;
  }

  /** 旋转后固定顺序：旋转 → 重新沉降 → 判定；不合法就返回原姿态 */
  function rotateAndPlace(box, placed, c, itemsById, axis, opts) {
    var rotated = rotate90(box, axis);
    rotated.x = box.x;
    rotated.y = box.y;
    rotated.z = box.z;
    var res = tryPlace(rotated, placed, c, itemsById, opts);
    if (!res.ok) return { ok: false, reason: res.reason, message: res.message, box: box };
    return res;
  }

  NS.manual = {
    overlaps: overlaps,
    inBounds: inBounds,
    settle: settle,
    snap: snap,
    tryPlace: tryPlace,
    rotate90: rotate90,
    rotateAndPlace: rotateAndPlace
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.manual;
})(typeof globalThis !== 'undefined' ? globalThis : this);
