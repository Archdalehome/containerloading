/*
 * 实体几何：判断「某个容器水平位置 (X,Y) 上，这一箱的实体占哪段高度」。
 *
 * 为什么需要它：占位矩形（外接体）重叠与否，判断不了对扣是否合法——两只斜顶箱的
 * 外接体在对扣时必然重叠（下件 0..500、上件 300..800），但实体可以严丝合缝。
 * 相反，如果翻转方向错了，外接体看起来"摆对了"，实体却会楔进去 200mm。
 * 之前所有断言都只看外接体，所以这种错法一路通过。
 *
 * 口径与 3D 渲染完全一致（js/ui/viewer.js 的 geometryFor）：
 *   局部坐标：x = 长（L，0..l），y = 深（W，0..w），z = 高（0..h）
 *   截面高度限制 limitAt():
 *     矩形   h
 *     L 形   深度 ≤ W低 时 H低，否则 H高（台阶沿深度方向）
 *     斜顶   H底 + (H高−H底) × x/L（顶面沿长度方向倾斜）
 *
 * 本文件不碰 DOM，浏览器与 Node 都能加载（自检用）。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  var EPS = 1e-6;
  var IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function svOf(item) {
    return item.shapeValues || item.bbox;
  }

  function dimsOf(item) {
    var sv = svOf(item);
    return [sv.l, sv.w, sv.h];
  }

  /** 局部坐标下 (x 沿长, y 沿深) 这一列的高度上限，从箱底算起 */
  function limitAt(item, x, y) {
    var sv = svOf(item);
    if (item.shape === 'lshape') return y <= sv.wlow + EPS ? sv.hlow : sv.hhigh;
    if (item.shape === 'slope') {
      var t = sv.l > 0 ? x / sv.l : 0;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      return sv.hlow + (sv.hhigh - sv.hlow) * t;
    }
    return sv.h;
  }

  /** 由姿态矩阵还原 {m, p, s, ...}，p[a] = 局部轴 a 映射到的容器轴，s[a] = 符号 */
  function poseFromMatrix(m) {
    var p = [0, 0, 0];
    var s = [1, 1, 1];
    for (var a = 0; a < 3; a++) {
      for (var j = 0; j < 3; j++) {
        if (Math.abs(m[j * 3 + a]) > 0.5) {
          p[a] = j;
          s[a] = m[j * 3 + a] > 0 ? 1 : -1;
        }
      }
    }
    return { m: m, p: p, s: s };
  }

  /**
   * p 这一箱在容器水平位置 (X, Y) 上的实体高度区间 [下沿, 上沿]。
   * 该位置不在箱体投影内时返回 null。X、Y 用容器坐标（mm）。
   */
  function spanAt(p, item, X, Y) {
    var d = dimsOf(item);
    if (!Number.isFinite(d[0]) || !Number.isFinite(d[1]) || !Number.isFinite(d[2])) return null;
    var m = p.pose || IDENT;

    var av = -1;
    var ax = -1;
    var ay = -1;
    for (var a = 0; a < 3; a++) {
      if (Math.abs(m[2 * 3 + a]) > 0.5) av = a;
      if (Math.abs(m[0 * 3 + a]) > 0.5) ax = a;
      if (Math.abs(m[1 * 3 + a]) > 0.5) ay = a;
    }
    if (av < 0 || ax < 0 || ay < 0 || ax === ay || ax === av || ay === av) return null;

    // 容器坐标 → 该箱局部「从底面/左侧算起」的坐标（0..d）
    var cx = X - (p.x + p.l / 2);
    var cy = Y - (p.y + p.w / 2);
    var fb = [0, 0, 0];
    fb[ax] = m[0 * 3 + ax] * cx + d[ax] / 2;
    fb[ay] = m[1 * 3 + ay] * cy + d[ay] / 2;
    if (fb[ax] < -EPS || fb[ax] > d[ax] + EPS) return null;
    if (fb[ay] < -EPS || fb[ay] > d[ay] + EPS) return null;

    // 竖直方向上的实体长度：竖轴就是箱高时按截面轮廓取，侧放时取该轴全长
    var lim = av === 2 ? limitAt(item, fb[0], fb[1]) : d[av];
    if (!(lim > EPS)) return null;

    var sign = m[2 * 3 + av] > 0 ? 1 : -1;
    var mid = p.z + p.h / 2;
    var e0 = mid + sign * (0 - d[av] / 2);
    var e1 = mid + sign * (lim - d[av] / 2);
    return e0 <= e1 ? [e0, e1] : [e1, e0];
  }

  /**
   * 两只箱子实体是否重叠（向量化采样，返回最大重叠深度 mm）。
   * 采样下件的投影网格；两件投影不重合的部分不产生重叠。
   */
  function overlapDepth(a, b, itemA, itemB, step) {
    var s = step || 10;
    var x0 = Math.max(a.x, b.x);
    var x1 = Math.min(a.x + a.l, b.x + b.l);
    var y0 = Math.max(a.y, b.y);
    var y1 = Math.min(a.y + a.w, b.y + b.w);
    if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return 0;
    var nx = Math.max(1, Math.ceil((x1 - x0) / s));
    var ny = Math.max(1, Math.ceil((y1 - y0) / s));
    var worst = 0;
    for (var i = 0; i < nx; i++) {
      var X = x0 + (i + 0.5) * (x1 - x0) / nx;
      for (var j = 0; j < ny; j++) {
        var Y = y0 + (j + 0.5) * (y1 - y0) / ny;
        var sa = spanAt(a, itemA, X, Y);
        if (!sa) continue;
        var sb = spanAt(b, itemB, X, Y);
        if (!sb) continue;
        var ov = Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0]);
        if (ov > worst) worst = ov;
      }
    }
    return worst;
  }

  /**
   * 对扣贴合检查：下件顶面与上件底面必须逐列贴合（误差 ≤ tol mm），且实体不重叠。
   * 返回 {overlap, gap, columns, skipped}；columns = 两件同时有实体的采样列数。
   *
   * 采样点正好落在台阶棱上时（例如对称 L 的 W低 边界），两件在那一列的归属各判各的，
   * 会出现一条 575mm 的假缝隙——棱是一条线、没有面积，不该算进去。所以某列不贴合时，
   * 往四个方向各挪 1mm 复核：邻居贴得上，就判为棱上的采样假象，跳过。
   */
  function pairFit(lower, upper, item, opts) {
    var s = (opts && opts.step) || 10;
    var tol = (opts && opts.tol) || 1;
    var nx = Math.max(1, Math.ceil(lower.l / s));
    var ny = Math.max(1, Math.ceil(lower.w / s));
    var overlap = 0;
    var gap = 0;
    var columns = 0;
    var skipped = 0;

    function metricAt(X, Y) {
      var a = spanAt(lower, item, X, Y);
      var b = spanAt(upper, item, X, Y);
      if (!a || !b) return null;
      return {
        ov: Math.min(a[1], b[1]) - Math.max(a[0], b[0]),
        gap: Math.abs(b[0] - a[1])
      };
    }

    for (var i = 0; i < nx; i++) {
      var X = lower.x + (i + 0.5) * lower.l / nx;
      for (var j = 0; j < ny; j++) {
        var Y = lower.y + (j + 0.5) * lower.w / ny;
        var m = metricAt(X, Y);
        if (!m) continue;
        if (m.ov > tol || m.gap > tol) {
          var around = [metricAt(X + 1, Y), metricAt(X - 1, Y), metricAt(X, Y + 1), metricAt(X, Y - 1)]
            .filter(Boolean);
          if (around.some(function (q) { return q.ov <= tol && q.gap <= tol; })) {
            skipped++;
            continue;
          }
        }
        columns++;
        if (m.ov > overlap) overlap = m.ov;
        if (m.gap > gap) gap = m.gap;
      }
    }
    return { overlap: overlap, gap: gap, columns: columns, tol: tol, skipped: skipped };
  }

  NS.solid = {
    EPS: EPS,
    poseFromMatrix: poseFromMatrix,
    limitAt: limitAt,
    spanAt: spanAt,
    overlapDepth: overlapDepth,
    pairFit: pairFit,
    dimsOf: dimsOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.solid;
})(typeof globalThis !== 'undefined' ? globalThis : this);
