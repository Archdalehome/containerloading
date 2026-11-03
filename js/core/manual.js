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
  if (!NS.solid && typeof require === 'function') NS.solid = require('./solid.js');
  var P = NS.pack;
  var SOLID = NS.solid;
  var EPS = 1e-6;
  var SUPPORT_TOL = 20; // 支撑面外扩(mm)：手工拖放允许 20mm 以内的悬挑，别让差几毫米就叠不上
  var IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function overlapsXY(a, b) {
    return a.x < b.x + b.l - EPS && b.x < a.x + a.l - EPS &&
      a.y < b.y + b.w - EPS && b.y < a.y + a.w - EPS;
  }

  /**
   * 两只箱子是否真的打架：外接框先筛，相交的少数对再用 solid 采样确认。
   * 只看外接框会把「小箱塞进 L 形缺口」误判成重叠（外接框必然相交、实体不碰）。
   */
  function overlaps(a, b, itemsById) {
    if (!overlapsXY(a, b)) return false;
    if (!(a.z < b.z + b.h - EPS && b.z < a.z + a.h - EPS)) return false;
    var ia = itemsById && itemsById[a.skuId];
    var ib = itemsById && itemsById[b.skuId];
    if (!ia || !ib || !SOLID || !SOLID.overlapDepth) return true;
    return SOLID.overlapDepth(a, b, ia, ib, 10) > 1;
  }

  function inBounds(box, c) {
    return box.x >= -EPS && box.y >= -EPS && box.z >= -EPS &&
      box.x + box.l <= c.innerL + EPS &&
      box.y + box.w <= c.innerW + EPS &&
      box.z + box.h <= c.innerH + EPS &&
      box.h <= c.doorH + EPS; // 门高是硬约束
  }

  /** 每一层的承重面（真实接触面，单位 mm）。
   *  支撑面按 SUPPORT_TOL 外扩：手工拖放不可能像素级对齐，允许很小的悬挑（默认 20mm），
   *  既不会让“差几毫米就叠不上去”，也不会放过真正的大悬挑。 */
  function levelsOf(placed, itemsById) {
    var levels = { 0: [] };
    placed.forEach(function (p) {
      var it = itemsById[p.skuId];
      if (!it || !P.surfacesOf) return;
      P.surfacesOf(it, p).forEach(function (s) {
        var k = Math.round(s.z * 1000) / 1000;
        (levels[k] = levels[k] || []).push({
          x: s.rect.x - SUPPORT_TOL,
          y: s.rect.y - SUPPORT_TOL,
          l: s.rect.l + SUPPORT_TOL * 2,
          w: s.rect.w + SUPPORT_TOL * 2
        });
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
    // 竖直硬约束先查：门高过不去的箱子，先说门高，别绕成「无支撑」
    if (box.h > c.doorH + EPS) {
      return { ok: false, reason: 'door-height', message: '箱高 ' + Math.round(box.h) + 'mm 超过柜门 ' + c.doorH + 'mm', box: box };
    }
    if (box.h > c.innerH + EPS) {
      return { ok: false, reason: 'too-tall', message: '箱高 ' + Math.round(box.h) + 'mm 超过柜内高 ' + c.innerH + 'mm', box: box };
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
      if (overlaps(box, placed[i], itemsById)) {
        return { ok: false, reason: 'overlap', message: '与已有箱体重叠', box: box, with: placed[i] };
      }
    }
    return { ok: true, box: box, snaps: snapped.snaps };
  }

  /* ---------- 旋转：累积 3×3 姿态矩阵，与自动模式同一套表示 ---------- */

  function mul3(a, b) {
    var o = new Array(9);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        o[i * 3 + j] = a[i * 3 + 0] * b[0 * 3 + j] +
          a[i * 3 + 1] * b[1 * 3 + j] +
          a[i * 3 + 2] * b[2 * 3 + j];
      }
    }
    return o;
  }
  var ROT = {
    x: [1, 0, 0, 0, 0, -1, 0, 1, 0],
    y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
    z: [0, -1, 0, 1, 0, 0, 0, 0, 1]
  };

  /**
   * 绕容器某根轴转 90°：姿态矩阵累乘、外廓同步换位。
   * 只换外廓不产出 pose 的话，L 形/斜顶箱在 3D 里会「外廓转了、楔形没转」。
   */
  function rotate90(box, axis) {
    var out = Object.assign({}, box);
    var R = ROT[axis] || ROT.z;
    out.pose = mul3(R, box.pose || IDENT);
    if (axis === 'x') { var t1 = out.w; out.w = out.h; out.h = t1; }
    else if (axis === 'y') { var t2 = out.l; out.l = out.h; out.h = t2; }
    else { var t3 = out.l; out.l = out.w; out.w = t3; }
    return out;
  }

  /** 旋转后固定顺序：旋转 → 重新沉降 → 判定；不合法就返回原姿态 */
  function rotateAndPlace(box, placed, c, itemsById, axis, opts) {
    var rotated = rotate90(box, axis);
    // 原地绕轴转：保持箱心在水平方向不动，否则箱子会“跑位”（往 +x/+y 长出去）
    rotated.x = box.x + (box.l - rotated.l) / 2;
    rotated.y = box.y + (box.w - rotated.w) / 2;
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
