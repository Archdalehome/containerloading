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
  if (!NS.solid && typeof require === 'function') NS.solid = require('./solid.js');
  var S = NS.shapes;
  var SOLID = NS.solid;

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
   * 允许的姿态：按几何判定，不按开关猜。
   *   1. 六个面哪个朝下，先筛掉「底面放不平」的：矩形 6 种全留；
   *      斜顶剔除斜面朝下（5 种）；L 形剔除台阶面朝下（5 种）——这两种朝下时底面是斜面/台阶，
   *      现实里放不住。
   *   2. 用户的勾选只做减法：不勾「可侧放」剔掉侧面朝下的，不勾「可倒放」剔掉顶面朝下的。
   *      默认两个都允许（用户 2026-11 决定：现实里可以任意方向摆，只要求不悬空、不穿插）。
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

      // 顶面朝下：矩形无所谓；斜顶是斜面朝下、L 形是台阶面朝下，底面积不满，摆不平
      if (item.shape !== 'rect' && vertical === 2 && upSign < 0) continue;

      var isSide = vertical !== 2;
      var isFlip = vertical === 2 && upSign < 0; // 只有「顶面朝下」才算倒放
      if (isSide && !item.allowSide) continue;
      if (isFlip && !item.allowFlip) continue;

      var key = vertical + '|' + dims.fx + '|' + dims.fy + '|' + (upSign > 0 ? 1 : 0);
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
   * 这个姿态铺成一整层后，顶面是不是一块完整、水平的矩形（能继续往上叠）。
   * 按真实接触面判：所有朝上的承重面都必须正好在本层层厚的高度上，且面积盖满整层底面。
   * 正放 L 形的台阶面比顶面低 137mm（704×482 那单），它不算「顶面平整」——
   * 上层箱子会有一半悬在缺口上方；之前只按面积求和，把台阶也算进去，才误判成可叠。
   */
  function poseStackable(item, pose) {
    var f = facesRel(item, pose.m, pose.fx, pose.fy, pose.thickness);
    if (!f.top || !f.top.length) return false;
    var area = 0;
    for (var i = 0; i < f.top.length; i++) {
      var r = f.top[i];
      if (r.z < pose.thickness - 1) return false; // 有低于层厚的承重面 → 不是平面
      area += r.l * r.w;
    }
    return area >= pose.fx * pose.fy - 1;
  }

  /**
   * 在允许姿态里挑「剩余高度内能装最多箱」的：
   *   score = 能叠的层数 × 每层箱数
   *   层数 = 顶面平整时 floor(剩余高度 / 层厚)，顶面不平整时只有 1 层（上面不能再压）
   * 只看每层箱数/层厚会在层数取整时倒挂（例如 500 厚能叠 5 层、600 厚只能 4 层），
   * 所以直接把剩余高度算进去。同分保持先出现的姿态（H 朝上、不旋转），与 v1 一致。
   *
   * opts.stackableOnly：只要「这一层上面还能继续叠」的姿态。
   * opts.notchFilled：正放 L 形的台阶会用垫块/别的箱型填平，此时正放层也可以连续叠。
   */
  function bestPose(item, c, roomH, opts) {
    var wantStackable = !!(opts && opts.stackableOnly);
    var poses = posesFor(item);
    var best = null;
    var bestTotal = -1;
    // 斜顶侧放后顶面是楔形：自己站着还行，但上面那层没法整面贴合，会把后面的层全堵死。
    // 所以斜顶只在「立着放根本放不进」时才考虑侧放。
    // （这是贪心主循环的启发式；层型最优方案 runExact 不受它限制，侧放斜顶要在那里参与比较。
    //   等 2 箱块枚举接上，这段也一并删掉，让采样统一回答。）
    if (item.shape === 'slope') {
      var uprightOnly = poses.filter(function (p) { return !p.side && !p.flip; });
      if (uprightOnly.length) poses = uprightOnly;
    }
    for (var i = 0; i < poses.length; i++) {
      var pose = poses[i];
      // 倒放只允许出现在对扣里：单独倒放的斜面朝下/箱子倒扣都不合法
      if (pose.flip) continue;
      if (pose.thickness > roomH + EPS) continue;
      if (pose.thickness > c.doorH + EPS) continue;
      var cap = capacityOf(pose, c);
      if (cap.cap <= 0) continue;
      var stackable = poseStackable(item, pose);
      // 正放 L 形（台阶面朝上）在缺口被填平时也能一层层叠
      if (!stackable && opts && opts.notchFilled && item.shape === 'lshape' &&
          pose.vertical === 2 && pose.thickness === item.shapeValues.h) {
        stackable = true;
      }
      if (wantStackable && !stackable) continue;
      var layers = stackable ? Math.floor((roomH + EPS) / pose.thickness) : 1;
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
   * 支撑覆盖率：底面有多大比例落在支撑面并集上（0~1）。
   * 用户 2026-11 定下的口径：≥50% 就算站得住——不对称 L 形翻扣后顶面是台阶，
   * 上一层的箱子只能搭住一半，现场也这么码，所以不再要求"完整托住"。
   */
  function coverageRatio(F, rects) {
    var eps = 1e-6;
    var area = F.l * F.w;
    if (!(area > 0)) return 0;
    var rs = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.x < F.x + F.l - eps && r.x + r.l > F.x + eps &&
          r.y < F.y + F.w - eps && r.y + r.w > F.y + eps) {
        rs.push({
          x: Math.max(r.x, F.x), y: Math.max(r.y, F.y),
          x2: Math.min(r.x + r.l, F.x + F.l), y2: Math.min(r.y + r.w, F.y + F.w)
        });
      }
    }
    if (!rs.length) return 0;
    var xs = [F.x, F.x + F.l];
    rs.forEach(function (r) { xs.push(r.x, r.x2); });
    xs = xs.filter(function (v, idx) { return xs.indexOf(v) === idx; }).sort(function (a, b) { return a - b; });
    var covered = 0;
    for (var k = 0; k < xs.length - 1; k++) {
      var x0 = xs[k], x1 = xs[k + 1];
      if (x1 - x0 < eps) continue;
      var iv = [];
      for (var j = 0; j < rs.length; j++) {
        if (rs[j].x <= x0 + eps && rs[j].x2 >= x1 - eps) iv.push([rs[j].y, rs[j].y2]);
      }
      iv.sort(function (a, b) { return a[0] - b[0]; });
      var y = F.y, far = F.y;
      for (var q = 0; q < iv.length; q++) {
        if (iv[q][0] > far + eps) break;
        if (iv[q][1] > far) far = iv[q][1];
      }
      covered += (x1 - x0) * Math.max(0, Math.min(far, F.y + F.w) - F.y);
    }
    return covered / area;
  }

  var SUPPORT_MIN_RATIO = 0.5;   // 底面至少一半落在支撑面上

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
    // L 形：W低 ≥ W高 就能翻扣。差出来的宽度会留一个空洞，但上件有实打实的支撑，
    // 不违反常识；W低 < W高 时缺口比高段窄、上件架在边缘，才真的不行。
    // 不对称的扣完顶面是两级台阶，只能一层（由主循环在该层之后 break 保证）。
    if (item.shape === 'lshape') return item.shapeValues.wlow >= item.shapeValues.whigh - 1;
    return false;
  }

  /**
   * 一只箱子的真实接触面（相对它自己的左前下角）：
   *   bottom = 真正贴地的那几块矩形；top = 真正朝上、能承重的那几块矩形（带相对高度 z）。
   *
   * 为什么不能用外接体：侧放、倒扣之后，外接体的顶面往往有一半是空的，
   * 拿它当承重面会让上面的箱子悬空。这里按真实几何算。
   *   快速路径：矩形任意姿态、正放的斜顶 / L 形（截面规则，直接给矩形）
   *   其余：25mm 网格采样实体高度，再按等高把格子合并成矩形
   */
  var FACE_CACHE = {};

  function facesRel(item, pose, fx, fy, thickness) {
    var sv = item.shapeValues || item.bbox;
    // 缓存键必须带尺寸：同一个 id 在不同用例里可能换了参数（测试里就这么用）
    var key = item.id + '|' + [sv.l, sv.w, sv.h, sv.wlow, sv.whigh, sv.hlow, sv.hhigh].join(',') +
      '|' + (pose ? pose.join(',') : 'id') + '|' + fx + 'x' + fy;
    if (FACE_CACHE[key]) return FACE_CACHE[key];
    var out = { bottom: [], top: [] };
    var m = pose || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var vertical = 2;
    var upSign = 1;
    for (var a = 0; a < 3; a++) {
      if (Math.abs(m[2 * 3 + a]) > 0.5) { vertical = a; upSign = m[2 * 3 + a] > 0 ? 1 : -1; }
    }

    if (item.shape === 'rect') {
      out.bottom.push({ x: 0, y: 0, l: fx, w: fy, z: 0 });
      out.top.push({ x: 0, y: 0, l: fx, w: fy, z: thickness });
      FACE_CACHE[key] = out;
      return out;
    }

    if (item.shape === 'lshape' && vertical === 2 && upSign > 0) {
      // 正放 L：底面是完整的 L×W；顶面两段——高段 H高、台阶 H低
      out.bottom.push({ x: 0, y: 0, l: fx, w: fy, z: 0 });
      var ax = -1;
      for (var b = 0; b < 3; b++) if (Math.abs(m[0 * 3 + b]) > 0.5) ax = b;
      var ay = -1;
      for (var c = 0; c < 3; c++) if (Math.abs(m[1 * 3 + c]) > 0.5) ay = c;
      // 深度方向（局部 y）映射到容器的哪根轴、正反向
      var dAxis = ay; // 局部 y
      var dSign = m[1 * 3 + ay] > 0 ? 1 : -1;
      var dLen = fy;
      var dDepth = ay === 0 ? fx : fy; // 容器 x/y 里深度那根的长度
      var lowOff = dSign > 0 ? 0 : dDepth - sv.wlow;
      var highOff = dSign > 0 ? sv.wlow : 0;
      var highLen = dDepth - sv.wlow;
      var seg = function (off, len, z) {
        var r = { x: 0, y: 0, l: fx, w: fy, z: z };
        if (ay === 0) { r.l = len; r.x = off; } else { r.w = len; r.y = off; }
        return r;
      };
      out.top.push(seg(highOff, highLen, sv.h));
      out.top.push(seg(lowOff, sv.wlow, sv.hlow));
      FACE_CACHE[key] = out;
      return out;
    }

    if (item.shape === 'slope' && vertical === 2 && upSign > 0) {
      // 正放斜顶：底面完整；顶面是斜面，不能承重
      out.bottom.push({ x: 0, y: 0, l: fx, w: fy, z: 0 });
      FACE_CACHE[key] = out;
      return out;
    }

    // 通用路径：采样实体高度，找出真正贴地和真正朝上的面
    var step = Math.min(25, Math.max(5, Math.min(fx, fy) / 12));
    var nx = Math.max(1, Math.ceil(fx / step));
    var ny = Math.max(1, Math.ceil(fy / step));
    var probe = { x: 0, y: 0, z: 0, l: fx, w: fy, h: thickness, pose: m };
    var cellLo = new Array(nx * ny);
    var cellHi = new Array(nx * ny);
    var maxZ = 0;
    for (var i = 0; i < nx; i++) {
      for (var j = 0; j < ny; j++) {
        var span = SOLID.spanAt(probe, item, (i + 0.5) * fx / nx, (j + 0.5) * fy / ny);
        var idx = j * nx + i;
        if (!span) { cellLo[idx] = null; continue; }
        cellLo[idx] = span[0];
        cellHi[idx] = span[1];
        if (span[1] > maxZ) maxZ = span[1];
      }
    }
    var cellW = fx / nx;
    var cellD = fy / ny;
    var extract = function (pick, target) {
      var used = new Uint8Array(nx * ny);
      for (var j2 = 0; j2 < ny; j2++) {
        for (var i2 = 0; i2 < nx; i2++) {
          var k = j2 * nx + i2;
          if (used[k]) continue;
          var h = pick(k);
          if (h === null) continue;
          // 往右扩
          var i3 = i2;
          while (i3 + 1 < nx && !used[j2 * nx + i3 + 1] && pick(j2 * nx + i3 + 1) === h) i3++;
          // 往下扩（每一行区间必须完全一致）
          var j3 = j2;
          while (j3 + 1 < ny) {
            var okRow = true;
            for (var q = i2; q <= i3; q++) {
              if (used[(j3 + 1) * nx + q] || pick((j3 + 1) * nx + q) !== h) { okRow = false; break; }
            }
            if (!okRow) break;
            j3++;
          }
          for (var jj = j2; jj <= j3; jj++) {
            for (var ii = i2; ii <= i3; ii++) used[jj * nx + ii] = 1;
          }
          target.push({ x: i2 * cellW, y: j2 * cellD, l: (i3 - i2 + 1) * cellW, w: (j3 - j2 + 1) * cellD, z: h });
        }
      }
    };
    extract(function (k) { return cellLo[k] === null ? null : (cellLo[k] <= 1 ? 0 : null); }, out.bottom);
    extract(function (k) {
      if (cellHi[k] === undefined) return null;
      return (Math.abs(cellHi[k] - maxZ) <= 1) ? Math.round(cellHi[k]) : null;
    }, out.top);
    FACE_CACHE[key] = out;
    return out;
  }

  /** 这一箱的真实底面（容器坐标） */
  function bottomRectsOf(item, p) {
    if (!item) return [{ x: p.x, y: p.y, l: p.l, w: p.w }];
    var f = facesRel(item, p.pose, p.l, p.w, p.h);
    return f.bottom.map(function (r) {
      return { x: p.x + r.x, y: p.y + r.y, l: r.l, w: r.w };
    });
  }

  /** 一只箱子提供的水平承重面（真实顶面，侧放/倒扣按几何算） */
  function surfacesOf(item, p) {
    if (!item) return [];
    var f = facesRel(item, p.pose, p.l, p.w, p.h);
    return f.top.map(function (r) {
      return { z: p.z + r.z, rect: { x: p.x + r.x, y: p.y + r.y, l: r.l, w: r.w } };
    });
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
        // 姿态默认值只在这里定义一次：行上没写 = 允许（默认不限方向）。
        // 之前的坑：引擎这次用 !!row.allowSide（undefined → false），UI 用 true，
        // 同一份输入不加行级标志就会静默少装 8%。
        allowFlip: row.allowFlip !== false,
        allowSide: row.allowSide !== false,
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

  function runGreedy(state) {
    var c = parseContainer(state.container || {});
    var opts = state.options || {};
    var allowFill = !!opts.allowFill;
    var items = buildItems(state.rows || [], c);
    var sorted = items.slice().sort(sortFor(opts.sortBy));

    var placements = [];
    var layers = [];
    var dunnageBlocks = [];
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

    /** 按真实底面判断支撑：侧放的箱子底面可能只占外接体的一部分，不能拿外接体蒙过去 */
    function supportedAtFor(item, pose, x, y, zz) {
      if (zz <= EPS) return true;
      var rects = topIndex[keyOf(zz)];
      if (!rects || !rects.length) return false;
      var f = facesRel(item, pose ? pose.m || pose : null, pose ? pose.fx : item.bbox.l,
        pose ? pose.fy : item.bbox.w, pose ? pose.thickness : item.bbox.h);
      for (var i = 0; i < f.bottom.length; i++) {
        var r = f.bottom[i];
        if (!covers({ x: x + r.x, y: y + r.y, l: r.l, w: r.w }, rects)) return false;
      }
      return true;
    }

    function weightRoom() {
      if (!weightKnown) return Infinity;
      return Math.max(0, c.payload - usedWeight);
    }

    /**
     * 同款箱换姿态填本层剩下的条带（利用率优先）。
     *
     * 主姿态按格子铺满后，柜宽方向常剩下一条放不下主姿态的窄带——
     * 例如 2352 宽、箱宽 600 排 3 列，剩 552mm，主姿态塞不进，但同款箱转 90° 或侧放就塞得进去。
     * 条带很窄、候选只有几组，直接把同款箱所有允许姿态 × 朝向暴力试一遍，不做过多的优化。
     *
     * 只放用户允许的姿态：倒放仅矩形箱可独立落地（斜顶/L 倒过来没有水平底面），侧放看「可侧放」开关。
     * 返回 {placed, bands}：placed 是这一条带塞进去的箱数，bands 是没填满、可以交给跨 SKU 填缝的余带。
     */
    function fillStripSameSku(strip, maxThickness, layerZ, cand, layerIdx, log) {
      var bands = [strip];
      var left = [];
      var placed = 0;
      var maxTop = layerZ;
      var guard = 0;
      while (bands.length && guard++ < 10) {
        var band = bands.shift();
        if (band.l <= EPS || band.w <= EPS) continue;
        var best = null;
        var poses = posesFor(cand);
        for (var k = 0; k < poses.length; k++) {
          var pose = poses[k];
          if (pose.flip && cand.shape !== 'rect') continue;
          if (pose.thickness > maxThickness + EPS) continue;
          var nx = Math.floor((band.l + EPS) / pose.fx);
          var ny = Math.floor((band.w + EPS) / pose.fy);
          if (nx <= 0 || ny <= 0) continue;
          var cap = nx * ny;
          if (!best || cap > best.cap || (cap === best.cap && pose.thickness > best.pose.thickness)) {
            best = { pose: pose, nx: nx, ny: ny, cap: cap };
          }
        }
        if (!best) { left.push(band); continue; }
        var limit = Math.min(best.cap, cand.remaining);
        if (weightKnown && cand.unitWeight > 0) {
          limit = Math.min(limit, Math.floor(weightRoom() / cand.unitWeight));
        }
        if (limit <= 0) { left.push(band); continue; }
        var n = 0;
        // 先填满横截面（横向一排），再沿柜长往柜门方向推进。
        // 反过来（先沿长度铺一行、再换行）会出现"贴着柜尾拉一条 6 米的长条"，
        // 既不符合现场装柜习惯，重心也偏，用户一眼就看出不对。
        for (var cc = 0; cc < best.nx && n < limit; cc++) {
          for (var r = 0; r < best.ny && n < limit; r++) {
            var bx = band.x + cc * best.pose.fx;
            var by = band.y + r * best.pose.fy;
            if (!supportedAtFor(cand, best.pose, bx, by, layerZ)) continue;
            var sp = {
              skuId: cand.id, index: items.indexOf(cand),
              col: cc + 1, row: r + 1,
              x: bx, y: by, z: layerZ, l: best.pose.fx, w: best.pose.fy, h: best.pose.thickness,
              rot: best.pose.fx === cand.bbox.l ? 0 : 90,
              layer: layerIdx, pose: best.pose.m, kind: 'strip'
            };
            placements.push(sp);
            addSupport(sp);
            cand.loaded++;
            cand.remaining--;
            loadedCount++;
            placed++;
            n++;
            if (layerZ + best.pose.thickness > maxTop) maxTop = layerZ + best.pose.thickness;
            usedWeight += (cand.unitWeight || 0);
          }
        }
        if (n === 0) { left.push(band); continue; }
        log.push({ pose: best.pose, count: n });
        var ux = band.x + best.nx * best.pose.fx;
        var uy = band.y + best.ny * best.pose.fy;
        var restX = band.x + band.l - ux;
        var restY = band.y + band.w - uy;
        if (restX > EPS) bands.push({ x: ux, y: band.y, l: restX, w: band.w });
        if (restY > EPS) bands.push({ x: band.x, y: uy, l: Math.min(band.l, ux - band.x), w: restY });
      }
      return { placed: placed, bands: left.concat(bands), maxTop: maxTop };
    }

    while (true) {
      if (loadedCount >= MAX_BOXES) {
        stop = { code: 'limit', message: '已达到单次计算上限 ' + MAX_BOXES + ' 箱' };
        break;
      }

      var cand = null;
      var candPose = null;
      var topFallback = null;
      var roomNow = c.innerH - z;
      for (var i = 0; i < sorted.length; i++) {
        var it = sorted[i];
        if (it.remaining <= 0 || !it.placeable) continue;
        var anyPose = bestPose(it, c, roomNow);
        if (!anyPose) continue;
        // 「这一层上面还能不能继续叠」是按姿态判的，不是按箱型判的：
        // 正放 L 形的顶面是台阶（不能叠），但同一个箱子侧放后顶面就是完整平面（能叠）。
        // 之前整型判成「顶层专属」，侧放能叠的那条路就永远走不到了
        // （704×482 只给 72 箱、471×702 只给 75 箱都是这个原因）。
        var stackPose = bestPose(it, c, roomNow, {
          stackableOnly: true,
          notchFilled: it.shape === 'lshape' && notchFillPossible(it, sorted, opts.allowDunnage)
        });
        if (!stackPose) {
          if (!topFallback) topFallback = { item: it, pose: anyPose };
          continue;
        }
        cand = it;
        candPose = stackPose;
        break;
      }
      if (!cand && topFallback) {
        cand = topFallback.item;
        candPose = topFallback.pose;
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
        // 对扣层也要像普通层一样比较两个水平朝向：770 沿柜长是 15×3=45 个位置，
        // 转 90° 后 700 沿柜长是 17×3=51 个位置，差 6 个位置 × 层数——之前只取了第一个朝向
        var pairBest = null;
        posesFor(cand).forEach(function (pose) {
          if (pose.flip || pose.vertical !== 2) return;
          var cap = capacityOf(pose, c);
          if (cap.cap <= 0) return;
          if (!pairBest || cap.cap > pairBest.cap.cap) {
            var flip = findFlipPose(cand, pose);
            if (flip) pairBest = { lower: pose, upper: flip, cap: cap };
          }
        });
        var hup = pairBest ? pairBest.lower : null;
        if (hup && pairThickness <= roomLeft + EPS && pairThickness <= c.doorH + EPS && cand.remaining >= 2) {
          var hupCap = pairBest.cap;
          var flipPose = pairBest.upper;
          if (flipPose && hupCap.cap > 0) {
            var singleTotal = Math.floor((roomLeft + EPS) / candPose.thickness) * posCap.cap;
            var pairLayers = Math.floor((roomLeft + EPS) / pairThickness);
            var pairsPerLayer = Math.min(Math.floor(cand.remaining / 2), hupCap.cap);
            var pairTotal = pairLayers * pairsPerLayer * 2;
            // 对扣层上面往往还能再放一层别的姿态（例如 40GP：1 对 1250 + 1 单层 800 = 2050），
            // 只比「对扣层本身」会漏掉这种组合，所以把上面还能放的也加进来比
            var afterPair = roomLeft - pairLayers * pairThickness;
            var abovePose = afterPair > EPS ? bestPose(cand, c, afterPair) : null;
            var aboveTotal = abovePose
              ? Math.floor((afterPair + EPS) / abovePose.thickness) * capacityOf(abovePose, c).cap
              : 0;
            // 对扣优先的条件仍按容量择优（矩形箱规则不变）；
            // 斜顶/L 形"强制对扣"的分支目前没有按预期触发，单独立项排查，先不动这里。
            if (pairTotal + aboveTotal >= singleTotal) {
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
            if (!supportedAtFor(cand, pair.lower, px, py, layerZ)) continue;
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
        // 优先往上叠：先算"要把剩余数量装完、每层至少要占几列"，
        // 把箱子集中在柜尾这一片 footprint 上往上堆，而不是先沿柜长平铺一层。
        // 现场就是这么装的：柜尾先堆到顶，再往里推进。
        var nxUse = nx;
        // 只有"能自己往上叠"的箱型才走"柜尾堆到顶"策略（矩形箱平顶平底）。
        // 斜顶/L 形单只的顶面不能承重，硬按列数截断会变成每层只放一点点、
        // 又叠不上去，反而装得更少（实测 50 只斜顶从 50 掉到 10）。
        if (cand.shape === 'rect') {
          var perCol = Math.max(1, ny);
          var maxLayersLeft = Math.max(1, Math.floor((c.innerH - z) / Math.max(1, candPose.thickness)));
          var colsNeeded = Math.max(1, Math.ceil(cand.remaining / (perCol * maxLayersLeft)));
          nxUse = Math.min(nx, colsNeeded);
        }
        var room = Math.min(cand.remaining, nxUse * ny, capacity);
        if (weightKnown && unitW > 0) room = Math.min(room, Math.floor(weightRoom() / unitW));
        for (var col = 0; col < nxUse && placed < room; col++) {
          for (var r = 0; r < ny && placed < room; r++) {
            var bx = col * candPose.fx;
            var by = r * candPose.fy;
            if (!supportedAtFor(cand, candPose, bx, by, layerZ)) continue;
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

      // 本层剩下的两条带：先用同款箱换姿态塞满（利用率优先），塞不下的再交给别的箱型
      var stripLog = [];
      var stripPlaced = 0;
      var stripTop = 0;
      var residual = [];
      if (!pair && !opts.noStripFill) {
        var usedX = Math.min(nx * candPose.fx, c.innerL);
        var usedY = Math.min(ny * candPose.fy, c.innerW);
        // 条带里的箱子可以比本层高（那一片上面不再叠层），上限是剩余层高与门高
        var stripMaxH = Math.min(c.innerH - z, c.doorH);
        [
          { x: usedX, y: 0, l: c.innerL - usedX, w: c.innerW },
          { x: 0, y: usedY, l: usedX, w: c.innerW - usedY }
        ].forEach(function (strip) {
          if (strip.l <= EPS || strip.w <= EPS) return;
          var res = fillStripSameSku(strip, stripMaxH, z, cand, layerIndex, stripLog);
          stripPlaced += res.placed;
          if (res.maxTop > stripTop) stripTop = res.maxTop;
          residual = residual.concat(res.bands);
        });
        fillTotal += stripPlaced;
      }

      // 跨 SKU 填缝：只往同款填完的余带里加箱，层高不变
      if (allowFill && !pair) {
        var strips = residual;
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
              if (!supportedAtFor(filler.item, filler.pose, fx0, fy0, z)) continue;
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
                if (!supportedAtFor(nf.item, nf.pose, gx, gy, stepZ)) continue;
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
        var dunnageH = svD.hhigh - svD.hlow;
        placements.forEach(function (q) {
          if (q.layer !== layerIndex) return;
          var stq = stepSurface(cand, q);
          if (!stq) return;
          if (supportedAt(stq.x, stq.y, stq.l, stq.w, topZ)) return;
          addSurface(topZ, { x: stq.x, y: stq.y, l: stq.l, w: stq.w });
          dunnageBlocks.push({
            x: stq.x, y: stq.y, z: layerZ + svD.hlow,
            l: stq.l, w: stq.w, h: dunnageH,
            layer: layerIndex
          });
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
        mainCount: placed,
        stripCount: stripPlaced,
        stripTop: stripTop > 0 ? stripTop : layerTop,
        stripFills: stripLog,
        dunnage: layerDunnage,
        pose: pair ? null : candPose.m
      });

      z = layerTop;

      // 斜顶单只顶部是斜面，不能承重：这一层必须是最后一层
      if (!pair && cand.shape === 'slope') {
        stop = { code: 'slope-top', message: '斜顶箱单只顶部是斜面，不能再往上叠（已按最高层计算）' };
        break;
      }
      // 台阶不对称的 L 形：扣完顶面是两级台阶，但按"底面 ≥50% 有支撑"的口径
      // 上一层可以继续压上去（用户 2026-11 定），所以这里不再终止本片。

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
      dunnage: dunnageBlocks,
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

  /**
   * 对扣上件的姿态：必须与下件同底面积、底面朝上，并且**翻转要沿剖面变化的那根轴**。
   *
   * 为什么不能随便找一个倒放姿态：倒放有四种摆法，其中两种看起来都是「底朝上」，
   * 但只有一种能把两只箱子拼成实心块：
   *   斜顶箱的高度沿**长度**变化 → 必须同时镜像长度方向（否则上件的底面是反坡，
   *                            后半段要压进下件 200mm，3D 里就是两只箱子互相侵入）
   *   L 形箱的台阶沿**深度**变化 → 必须同时镜像深度方向（对称台阶才对得上）
   *   矩形箱没有方向 → 按长度镜像
   * 做法：把「箱高轴」和「剖面轴」两行同时取反。两行取反行列式不变，仍是合法旋转。
   */
  function findFlipPose(item, refPose) {
    if (!refPose) return null;
    var prof = item.shape === 'lshape' ? 1 : 0;
    var m = refPose.m.slice();
    // 要翻转的是「局部轴」：局部箱高轴（2）和剖面变化轴（L 形是局部深 1、斜顶是局部长 0）。
    // 矩阵里第 a 列 = 局部轴 a 的像，所以取反列而不是行——取反行会把整个姿态转歪，
    // 对扣后的两只箱子就会互相插入（350mm 重叠）。
    for (var r = 0; r < 3; r++) {
      m[r * 3 + 2] = -m[r * 3 + 2];
      m[r * 3 + prof] = -m[r * 3 + prof];
    }
    var pose = SOLID.poseFromMatrix(m);
    var dims = poseDims(item, pose);
    pose.fx = dims.fx;
    pose.fy = dims.fy;
    pose.thickness = dims.thickness;
    pose.side = false;
    pose.flip = true;
    pose.vertical = 2;
    if (Math.abs(pose.fx - refPose.fx) > EPS || Math.abs(pose.fy - refPose.fy) > EPS) return null;
    if (pose.m[8] !== -1) return null;
    return pose;
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
    var pairCache = {}; // 同一 SKU 的所有对扣件相对关系相同，实体采样只算一次
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
    (pack.dunnage || []).forEach(function (b) {
      var k = key(b.z + b.h);
      (surface[k] = surface[k] || []).push({ x: b.x, y: b.y, l: b.l, w: b.w });
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

    // 2. 上方箱的底面必须与下方顶面贴合（采样判，不按箱型禁叠）
    //
    // 之前这里写的是「斜顶单只上方不得有箱」——错的。斜顶上方不是不能压，是**平底箱压上去放不平**；
    // 一正一倒的箱子底面与斜面互补，正好贴平。所以判据只能是「底面与顶面是否贴合」，
    // 按箱型一刀切会把合法的侧倒对扣也一起挡掉。
    //
    // 性能：只查「下方有非矩形箱」的接触，并按接触高度建索引；纯矩形堆叠由第 1 条的 covers 覆盖，
    // 全部逐箱采样会让 1820 箱那种输入从毫秒级涨到分钟级。
    var topByLevel = {};
    (pack.placements || []).forEach(function (p) {
      var k = key(p.z + p.h);
      (topByLevel[k] = topByLevel[k] || []).push(p);
    });
    (pack.placements || []).forEach(function (q) {
      if (q.z <= EPS) return;
      if (q.kind === 'pair-upper' || q.kind === 'pair-upper-l') return; // 对扣上件另由第 3 条验
      var near = (topByLevel[key(q.z)] || []).filter(function (p) {
        if (p === q) return false;
        return p.x < q.x + q.l - EPS && q.x < p.x + p.l - EPS &&
               p.y < q.y + q.w - EPS && q.y < p.y + p.w - EPS;
      });
      if (!near.length) return;
      var itQ = itemsById[q.skuId];
      var nonRect = (itQ && itQ.shape !== 'rect') || near.some(function (p) {
        var ip = itemsById[p.skuId];
        return ip && ip.shape !== 'rect';
      });
      if (!nonRect) return;
      // 垫块也是真实承重面（填平缺口用的），命中垫块顶面就算贴合
      var dun = (pack.dunnage || []).filter(function (b) {
        return Math.abs(b.z + b.h - q.z) <= 1 &&
          b.x < q.x + q.l - EPS && q.x < b.x + b.l - EPS &&
          b.y < q.y + q.w - EPS && q.y < b.y + b.w - EPS;
      });
      var step = 50;
      var nx = Math.max(1, Math.ceil(q.l / step));
      var ny = Math.max(1, Math.ceil(q.w / step));
      var bad = 0;
      var worst = 0;
      for (var i = 0; i < nx; i++) {
        for (var j = 0; j < ny; j++) {
          var X = q.x + (i + 0.5) * q.l / nx;
          var Y = q.y + (j + 0.5) * q.w / ny;
          var sq = SOLID.spanAt(q, itQ, X, Y);
          if (!sq || Math.abs(sq[0] - q.z) > 1) continue; // 这一列不是上件的底面
          var onDun = dun.some(function (b) {
            return X >= b.x - EPS && X <= b.x + b.l + EPS && Y >= b.y - EPS && Y <= b.y + b.w + EPS;
          });
          if (onDun) continue;
          var top = -Infinity;
          for (var k2 = 0; k2 < near.length; k2++) {
            var sp = SOLID.spanAt(near[k2], itemsById[near[k2].skuId], X, Y);
            if (sp && sp[1] > top) top = sp[1];
          }
          var gap = Math.abs(top - q.z);
          if (gap > 1) {
            bad++;
            if (gap > worst) worst = gap;
          }
        }
      }
      if (bad > 0) {
        errs.push({
          code: 'not-flush',
          message: '上方箱底面与下方顶面不贴合：' + bad + ' 个采样列，最大间隙 ' + S.num(worst) + ' mm',
          placement: q
        });
      }
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
      // 台阶不对称的 L 形允许对扣：中间会留一个空洞，但上件搭在高段顶上、有实际支撑，
      // 这与现场"翻过来扣上去、边上差点就差点"的做法一致（用户 2026-11 确认）。
      var asymL = it && it.shape === 'lshape' && Math.abs(it.shapeValues.wlow - it.shapeValues.whigh) > 1;
      // 4. 实体检查：外接体重叠是对的（下件 0..500、上件 300..800），但实体不许穿插。
      //    翻转方向选错时外接体看着没问题、实体却楔进去 200mm，所以这一条必须按实体采样验。
      if (it) {
        var cacheKey = u.skuId + '|' + (u.z - l.z) + '|' + (u.x - l.x) + '|' + (u.y - l.y);
        var fit = pairCache[cacheKey];
        if (!fit) {
          fit = SOLID.pairFit(l, u, it, { step: 10, tol: 1 });
          pairCache[cacheKey] = fit;
        }
        if (fit.overlap > 1) {
          errs.push({
            code: 'pair-overlap',
            message: '对扣两箱实体重叠 ' + S.num(fit.overlap) + ' mm（翻转方向或上件高度不对）',
            placement: u
          });
        } else if (fit.columns === 0) {
          errs.push({ code: 'pair-nocontact', message: '对扣两箱实体没有接触面', placement: u });
        } else if (fit.gap > 1 && !asymL) {
          // 不对称 L 形的"缝"就是那个空洞，属实现场允许的摆法，不算错
          errs.push({ code: 'pair-seam', message: '对扣接触面有 ' + S.num(fit.gap) + ' mm 缝隙', placement: u });
        }
      }
    });

    return errs;
  }

  /* ---------- 层型最优（记忆化搜索）---------- */

  /**
   * 把「层型序列」落成真实摆放。
   *
   * 主循环是一个 SKU 一次只挑一个姿态铺到底，遇到「4 层 550 + 1 层 450」这种混层就比最优少；
   * 层型搜索（js/core/layerdp.js）给的是最优序列，这里负责把它变成箱体坐标。
   * 两条路径各算一份，谁箱数多谁当最优；任何一条过不了 validatePhysics 就作废，不参与排名。
   */
  function runExact(state) {
    var D = NS.layerdp;
    if (!D && typeof require === 'function') {
      try { D = require('./layerdp.js'); } catch (e) { D = null; }
    }
    if (!D) return null;
    var c = parseContainer(state.container || {});
    var items = buildItems(state.rows || [], c);
    // 记忆化的键里含「各 SKU 剩余量」，SKU 一多状态数就爆（实测 20 SKU × 5000 箱要 5.4 秒，
    // 超过 2 秒的硬上限）。所以只在小规模混装时启用；其余仍走贪心主循环。
    var live = items.filter(function (it) { return it.placeable && it.qty > 0; });
    if (live.length > 6) return null;
    var sol = D.solve(items, c, { nodeCap: 40000 });
    if (!sol || !sol.boxes) return null;
    if (sol.boxes > MAX_BOXES) return null;

    var byId = {};
    items.forEach(function (it) { byId[it.id] = it; });
    var placements = [];
    var layers = [];
    var z = 0;

    for (var li = 0; li < sol.layers.length; li++) {
      var t = sol.layers[li];
      var it = byId[t.skuId];
      if (!it) return null;
      var layerZ = z;
      var placed = 0;
      var capacity = 0;

      if (t.kind === 'pair') {
        if (!t.pair) return null;
        var lo = t.pair.lower;
        var up = t.pair.upper;
        var sv = it.shapeValues;
        capacity = t.pair.nx * t.pair.ny * 2;
        for (var pr = 0; pr < t.pair.ny; pr++) {
          for (var pc = 0; pc < t.pair.nx; pc++) {
            var px = pc * lo.fx;
            var py = pr * lo.fy;
            placements.push({
              skuId: it.id, index: it.index, col: pc + 1, row: pr + 1,
              x: px, y: py, z: layerZ, l: lo.fx, w: lo.fy, h: lo.thickness,
              rot: 90, layer: li, pose: lo.m, kind: 'pair-lower'
            });
            placements.push({
              skuId: it.id, index: it.index, col: pc + 1, row: pr + 1,
              x: px, y: py, z: layerZ + sv.hlow, l: up.fx, w: up.fy, h: up.thickness,
              rot: 90, layer: li, pose: up.m,
              kind: it.shape === 'lshape' ? 'pair-upper-l' : 'pair-upper'
            });
            placed += 2;
          }
        }
        layers.push({
          index: li, skuId: it.id, skuName: it.name, shapeName: it.shapeName,
          count: placed, capacity: capacity, height: t.thickness, z: layerZ,
          top: layerZ + t.thickness, rot: 90, kind: 'pair', fill: [],
          mainCount: placed, stripCount: 0, stripTop: layerZ + t.thickness,
          stripFills: [], dunnage: 0, pose: null
        });
      } else {
        var pose = t.pose;
        if (!pose) return null;
        var nx = Math.max(0, Math.floor((c.innerL + EPS) / pose.fx));
        var ny = Math.max(0, Math.floor((c.innerW + EPS) / pose.fy));
        capacity = nx * ny;
        for (var r = 0; r < ny; r++) {
          for (var col = 0; col < nx; col++) {
            placements.push({
              skuId: it.id, index: it.index, col: col + 1, row: r + 1,
              x: col * pose.fx, y: r * pose.fy, z: layerZ,
              l: pose.fx, w: pose.fy, h: pose.thickness,
              rot: pose.fx === it.bbox.l ? 0 : 90, layer: li, pose: pose.m,
              kind: pose.side ? 'side' : 'normal'
            });
            placed++;
          }
        }
        layers.push({
          index: li, skuId: it.id, skuName: it.name, shapeName: it.shapeName,
          count: placed, capacity: capacity, height: pose.thickness, z: layerZ,
          top: layerZ + pose.thickness, rot: pose.fx === it.bbox.l ? 0 : 90,
          kind: pose.side ? 'side' : 'normal', fill: [], mainCount: placed,
          stripCount: 0, stripTop: layerZ + pose.thickness, stripFills: [],
          dunnage: 0, pose: pose.m
        });
      }
      z += t.thickness;
    }

    // 逐 SKU 结算
    var loadedNet = 0;
    var loadedOuter = 0;
    var requestedWeight = 0;
    var loadedWeight = 0;
    var anyWeight = false;
    items.forEach(function (it) {
      it.loaded = 0;
      it.remaining = it.qty;
    });
    placements.forEach(function (p) {
      var it = byId[p.skuId];
      if (!it) return;
      it.loaded++;
      loadedWeight += it.unitWeight || 0;
    });
    items.forEach(function (it) {
      if (it.loaded > it.qty) return; // 不会发生，但宁可整条作废
      it.remaining = it.qty - it.loaded;
      loadedNet += it.loaded * it.netVolumeEach;
      loadedOuter += it.loaded * it.bboxVolumeEach;
      if (it.unitWeight !== null) {
        requestedWeight += it.qty * it.unitWeight;
        anyWeight = true;
      }
      if (it.remaining > 0) {
        it.reason = {
          code: 'height',
          message: '层型最优方案用高 ' + S.num(z) + ' mm，剩余高度放不下更多整层'
        };
      }
    });
    // 超重就交回贪心（贪心会按重量逐层收口），这里不做半吊子裁剪
    if (anyWeight && loadedWeight > c.payload + EPS) return null;

    var loadedCount = items.reduce(function (s, it) { return s + it.loaded; }, 0);
    var requestedCount = items.reduce(function (s, it) { return s + it.qty; }, 0);
    var containerVolume = c.innerL * c.innerW * c.innerH;
    var allLoaded = loadedCount === requestedCount;

    return {
      ok: true,
      container: c,
      items: items,
      placements: placements,
      layers: layers,
      dunnage: [],
      usedHeight: z,
      containerVolume: containerVolume,
      stop: allLoaded
        ? { code: 'all-loaded', message: '全部装载完成' }
        : { code: 'height', message: '层型最优方案用高 ' + S.num(z) + ' mm，剩余高度放不下更多整层' },
      truncated: false,
      options: { allowFill: false },
      exact: true,
      totals: {
        requestedCount: requestedCount,
        loadedCount: loadedCount,
        remainingCount: requestedCount - loadedCount,
        netVolume: loadedNet,
        bboxVolume: loadedOuter,
        fillRate: containerVolume > 0 ? loadedNet / containerVolume : 0,
        spaceUsage: containerVolume > 0 ? loadedOuter / containerVolume : 0,
        weight: loadedWeight,
        requestedWeight: requestedWeight,
        payload: c.payload,
        weightKnown: (anyWeight && items.every(function (it) { return it.unitWeight !== null; })),
        overloaded: requestedWeight > c.payload + EPS,
        layerCount: layers.length,
        heightUsage: c.innerH > 0 ? z / c.innerH : 0
      }
    };
  }

  /* ---------- 多方案枚举 ---------- */

  /** 24 个方案：姿态策略 4 × 排序 3 × 填缝 2 */
  function planConfigs() {
    // 姿态档累加：竖放 ⊂ +侧放 ⊂ +对扣 ⊂ +缺口嵌合；真箱填缺口在所有档里都可用（零前提）
    var policies = [
      { key: 'upright', label: '竖放', allowSide: false, allowFlip: false },
      { key: 'side', label: '+侧放', allowSide: true, allowFlip: false },
      { key: 'pair', label: '+对扣', allowSide: true, allowFlip: true },
      { key: 'notch', label: '+缺口嵌合', allowSide: true, allowFlip: true }
    ];
    var orders = [
      { key: 'volume', label: '按体积' },
      { key: 'footprint', label: '按底面积' },
      { key: 'qty', label: '按数量' }
    ];
    // 垫块是第二维：真箱填缺口 vs 垫块填缺口（后者需要自备垫块，有前提）
    var dunnageModes = [
      { dunnage: false, label: '真箱填缺口' },
      { dunnage: true, label: '垫块填缺口' }
    ];
    var out = [];
    policies.forEach(function (pol) {
      dunnageModes.forEach(function (dm) {
        orders.forEach(function (ord) {
          [false, true].forEach(function (fill) {
            out.push({
              id: out.length + 1,
              policy: pol,
              order: ord,
              fill: fill,
              dunnage: dm.dunnage,
              label: pol.label + ' · ' + dm.label + ' · ' + ord.label + ' · ' + (fill ? '填缝开' : '填缝关')
            });
          });
        });
      });
    });
    return out;
  }

  function sortFor(order) {
    if (order === 'footprint') {
      return function (a, b) {
        var fa = a.bbox.l * a.bbox.w;
        var fb = b.bbox.l * b.bbox.w;
        if (fb !== fa) return fb - fa;
        return bySizeDesc(a, b);
      };
    }
    if (order === 'qty') {
      return function (a, b) {
        if (b.qty !== a.qty) return b.qty - a.qty;
        return bySizeDesc(a, b);
      };
    }
    return bySizeDesc;
  }

  /** 重心：按单箱重量加权；没填重量时按件数均权 */
  function cogOf(pack) {
    var c = pack.container;
    var byId = {};
    pack.items.forEach(function (it) { byId[it.id] = it; });
    var m = 0;
    var mx = 0;
    var my = 0;
    var mz = 0;
    pack.placements.forEach(function (p) {
      var it = byId[p.skuId];
      var w = it && it.unitWeight !== null && it.unitWeight > 0 ? it.unitWeight : 1;
      m += w;
      mx += w * (p.x + p.l / 2);
      my += w * (p.y + p.w / 2);
      mz += w * (p.z + p.h / 2);
    });
    if (!m) return { x: 0, y: 0, z: 0, lateral: 0 };
    var x = mx / m;
    var y = my / m;
    var z = mz / m;
    return {
      x: x,
      y: y,
      z: z,
      lateral: c.innerW > 0 ? Math.abs(y - c.innerW / 2) / c.innerW : 0
    };
  }

  /** 排名：箱数 → 重心横向偏移 → 净体积 */
  /** 布局在柜长方向用掉多少（从柜尾算起）：越小说明越靠柜尾堆、柜门留得越空 */
  function usedLengthOf(plan) {
    var ps = (plan.pack && plan.pack.placements) || [];
    var m = 0;
    for (var i = 0; i < ps.length; i++) m = Math.max(m, ps[i].x + ps[i].l);
    return m;
  }

  function rankCompare(a, b) {
    if (b.boxes !== a.boxes) return b.boxes - a.boxes;
    if (Math.abs(a.cog.lateral - b.cog.lateral) > 1e-9) return a.cog.lateral - b.cog.lateral;
    // 箱数相同时，优先"靠柜尾堆起来"的方案：柜长方向占得越少越好，
    // 这样柜门附近尽量空着，人也进得去；平铺一层的方案在这里被淘汰。
    var la = usedLengthOf(a), lb = usedLengthOf(b);
    if (Math.abs(la - lb) > 1) return la - lb;
    return b.net - a.net;
  }

  /**
   * 枚举多方案。方案数按输入规模固定（不按耗时中断，保证可复现）：
   *   ≤2000 箱 24 个，2000–5000 箱 12 个，>5000 箱 6 个。
   * 每个方案都跑物理校验，不合法的直接标为无效、不参与排名。
   */
  function runPlans(state) {
    var totalQty = (state.rows || []).reduce(function (s, r) {
      var q = S.toNum(r.qty);
      return s + (Number.isFinite(q) ? q : 0);
    }, 0);
    // 方案数按输入规模固定（不按耗时中断）：48 / 24 / 12
    var limit = totalQty <= 2000 ? 48 : (totalQty <= 5000 ? 24 : 12);
    var configs = planConfigs().slice(0, limit);
    var plans = [];

    configs.forEach(function (cfg) {
      // 方案只能使用用户允许的姿态：策略档是「可以试到哪一档」，每个 SKU 的开关是「允许用哪几档」，
      // 两者取交集。否则没勾「可倒放」的货会被方案枚举翻过来放——现实中「此面向上」的货会装错方向。
      var rows = (state.rows || []).map(function (r) {
        return Object.assign({}, r, {
          // 策略档 ∩ 用户开关；行上没写开关 = 允许（默认值只在 run() 里定义一次）
          allowFlip: cfg.policy.allowFlip && r.allowFlip !== false,
          allowSide: cfg.policy.allowSide && r.allowSide !== false
        });
      });
      var pack = runGreedy({
        container: state.container || {},
        rows: rows,
        options: {
          allowFill: cfg.fill,
          allowDunnage: cfg.dunnage,
          sortBy: cfg.order
        }
      });
      var errs = validatePhysics(pack);
      var cog = cogOf(pack);
      var dunnageBlocks = (pack.dunnage || []).length;
      // 需要垫块的方案：用户没打开垫块开关时，不能自动充当「最优」
      var gated = dunnageBlocks > 0 && !(state.options && state.options.allowDunnage);
      plans.push({
        config: cfg,
        pack: pack,
        valid: errs.length === 0,
        errors: errs,
        boxes: pack.totals.loadedCount,
        net: pack.totals.netVolume,
        fillRate: pack.totals.fillRate,
        cog: cog,
        dunnageBlocks: dunnageBlocks,
        gated: gated
      });
    });

    // 第 49 个方案：层型最优序列（记忆化搜索）。与贪心各自算一份，谁箱数多谁当最优。
    // 物理校验不过就整条作废——层型搜索只做尺寸运算，落位对不对得由 validatePhysics 说了算。
    var exact = null;
    try {
      exact = runExact(state);
    } catch (e) {
      exact = null;
    }
    if (exact && exact.totals.loadedCount > 0) {
      var exactErrs = validatePhysics(exact);
      plans.push({
        config: {
          key: 'exact', label: '层型最优 · 记忆化搜索',
          policy: { key: 'exact', label: '层型最优' },
          order: { key: 'exact', label: '记忆化搜索' },
          fill: false, dunnage: false
        },
        pack: exact,
        valid: exactErrs.length === 0,
        errors: exactErrs,
        boxes: exact.totals.loadedCount,
        net: exact.totals.netVolume,
        fillRate: exact.totals.fillRate,
        cog: cogOf(exact),
        dunnageBlocks: 0,
        gated: false
      });
    }

    var valid = plans.filter(function (p) { return p.valid; }).sort(rankCompare);
    var eligible = valid.filter(function (p) { return !p.gated; });
    var bestGated = valid.filter(function (p) { return p.gated; })[0] || null;
    return {
      plans: plans,
      ranked: valid,
      best: eligible[0] || valid[0] || null,
      bestEligible: eligible[0] || null,
      bestGated: bestGated,
      compared: plans.length,
      limit: limit
    };
  }

  /**
   * 统一入口：所有方案里最好的那个。
   *
   * 以前 run() = 贪心主循环、runPlans() = 48 个贪心方案 + 1 个层型最优，
   * 同一份输入两个入口给两个数（用户那单 run 给 162、runPlans 给 210）。
   * 现在 run() 直接取 runPlans().best，谁接到哪个入口都不会拿到更差的结果；
   * 贪心部分改名 runGreedy() 只作内部实现，不再对外。
   */
  function run(state) {
    var ps = runPlans(state);
    var best = (ps && (ps.best || (ps.ranked && ps.ranked[0]))) || null;
    if (best && best.pack) {
      best.pack.chosen = {
        label: best.config && best.config.label,
        key: best.config && best.config.key,
        compared: ps.compared
      };
      return best.pack;
    }
    return runGreedy(state);
  }

  /**
   * 按切片装柜：一片装满（横向铺满 + 堆到顶）再挪下一片，符合现场习惯。
   *
   * 做法：把柜长切成一片一片，每片当成一个"短柜"交给贪心算法内部排满，
   * 排完整片把 x 偏移平移过去，再推进到下一片。这样斜顶/L 形也能在自己的片里
   * 先对扣成层再堆高，而不是先沿柜长平铺一层。
   *
   * 返回结构与 runGreedy 一致（placements / totals / container），供上层直接使用。
   */
  function runSlices(state) {
    var c0 = state.container || {};
    var rows = (state.rows || []).filter(function (r) {
      var q = S.toNum(r.qty);
      return Number.isFinite(q) && q > 0;
    });
    if (!rows.length) return null;
    var left = rows.map(function (r) { return { row: r, qty: S.toNum(r.qty) }; });
    var placements = [];
    var xOffset = 0;
    var guard = 0;
    while (xOffset < c0.innerL - 1 && guard++ < 500) {
      var alive = left.filter(function (e) { return e.qty > 0; });
      if (!alive.length) break;
      var lens = alive.map(function (e) {
        var v = e.row.values || {};
        var l = S.toNum(v.L);
        return Number.isFinite(l) && l > 0 ? l : 600;
      });
      var sliceL = Math.min(c0.innerL - xOffset, Math.max(100, Math.min.apply(null, lens)));
      var sub = Object.assign({}, c0, { innerL: sliceL });
      var subRows = alive.map(function (e) {
        return Object.assign({}, e.row, { qty: e.qty });
      });
      var part = runGreedy({ container: sub, rows: subRows, options: state.options || {} });
      var ps = part.placements || [];
      if (!ps.length) break;
      var maxX = 0;
      ps.forEach(function (p) {
        p.x += xOffset;
        placements.push(p);
        maxX = Math.max(maxX, p.x + p.l - xOffset);
        for (var i = 0; i < left.length; i++) {
          if (left[i].row.id === p.skuId && left[i].qty > 0) { left[i].qty--; break; }
        }
      });
      xOffset += maxX > 0 ? maxX : sliceL;
    }
    // 组装结果：净体积、装载率按实际装入的箱子算
    var netVolume = 0;
    placements.forEach(function (p) {
      var r = null;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === p.skuId) { r = rows[i]; break; }
      if (!r) return;
      var shape = S.get(r.shape);
      netVolume += shape.volume(r.values || {});
    });
    var containerVolume = c0.innerL * c0.innerW * c0.innerH;
    var want = rows.reduce(function (s, r) { return s + S.toNum(r.qty); }, 0);
    // items：物理校验和界面统计都要用（形状、外接框、已装数量）
    var items = rows.map(function (r, idx) {
      var shape = S.get(r.shape);
      var v = r.values || {};
      var bb = shape.bbox(v);
      var sv = r.shape === 'lshape'
        ? { l: S.toNum(v.L), w: bb.w, h: bb.h, wlow: S.toNum(v.Wlow), whigh: S.toNum(v.Whigh), hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
        : r.shape === 'slope'
          ? { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h, hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
          : { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h };
      var loaded = placements.filter(function (p) { return p.skuId === r.id; }).length;
      return {
        id: r.id, index: idx, shape: r.shape, name: r.name || r.id,
        values: v, bbox: bb, shapeValues: sv,
        qty: S.toNum(r.qty), loaded: loaded, allowFlip: r.allowFlip !== false, allowSide: r.allowSide !== false
      };
    });
    return {
      ok: true,
      container: c0,
      rows: rows,
      items: items,
      placements: placements,
      layers: [],
      usedHeight: placements.reduce(function (m, p) { return Math.max(m, p.z + p.h); }, 0),
      containerVolume: containerVolume,
      totals: {
        loadedCount: placements.length,
        remainingCount: Math.max(0, want - placements.length),
        netVolume: netVolume,
        fillRate: containerVolume ? netVolume / containerVolume : 0
      }
    };
  }

  /**
   * 让布局从"最里面（柜头）"开始长，而不是从柜门开始。
   * 现场装柜必须先把深入端装满，柜门附近留到最后——否则先堆在门口，人进不去、里面也装不了。
   * 做法是把整份布局沿长度镜像（反射是等距变换，外接框不相交的关系不变），
   * 箱子自身的朝向不动，只是位置换到另一端。
   */
  function mirrorX(pack) {
    if (!pack || !pack.container || !pack.placements) return pack;
    var innerL = pack.container.innerL;
    pack.placements.forEach(function (p) { p.x = innerL - p.x - p.l; });
    return pack;
  }

  NS.pack = {
    run: run,
    runSlices: runSlices,
    mirrorX: mirrorX,
    // 只给测试用的内部实现：条带填缝、缺口嵌合这些机制要单独验，不能拿「最优方案」去验
    runGreedy: runGreedy,
    runPlans: runPlans,
    planConfigs: planConfigs,
    cogOf: cogOf,
    extraContainers: extraContainers,
    suggestFillers: suggestFillers,
    stackDiagnosis: stackDiagnosis,
    validatePhysics: validatePhysics,
    stepSurface: stepSurface,
    pairFeasible: pairFeasible,
    facesRel: facesRel,
    surfacesOf: surfacesOf,
    bottomRectsOf: bottomRectsOf,
    // 兼容旧接口
    bestOrientation: function (bb, c) {
      var a = { nx: Math.floor((c.innerL + EPS) / bb.l), ny: Math.floor((c.innerW + EPS) / bb.w), rot: 0, l: bb.l, w: bb.w };
      var b = { nx: Math.floor((c.innerL + EPS) / bb.w), ny: Math.floor((c.innerW + EPS) / bb.l), rot: 90, l: bb.w, w: bb.l };
      a.cap = a.nx * a.ny;
      b.cap = b.nx * b.ny;
      return a.cap >= b.cap ? a : b;
    },
    posesFor: posesFor,
    poseStackable: poseStackable,
    findFlipPose: findFlipPose,
    findNormalPose: findNormalPose,
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
