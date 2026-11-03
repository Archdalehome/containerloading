/*
 * 层型背包：把「用哪种姿态铺一层」当成背包里的物品，由高度背包决定用不用它，
 * 而不是先挑一个主姿态、然后祈祷它上面还能叠。
 *
 * 层型 = (SKU, 姿态, 层厚, 每层箱数, 顶面是否可叠)
 *   - 矩形任意姿态：顶面平整 → 可叠
 *   - 斜顶正放 / 侧放：顶面是楔形 → 不可叠（只能当最后一层）
 *   - 斜顶对扣：顶面拼平 → 可叠，每对用 2 箱
 *   - L 形正放：顶面是台阶 → 不可叠；L 形对扣（对称台阶）→ 可叠
 *   - 任何姿态侧放后顶面是平面 → 可叠（L 侧放顶面是 L 形面，按格子能盖满才算可叠，见 stackable 计算）
 *
 * 求解：高度背包 DP（单位 mm，柜内高 ≤ 3000，直接开数组）。
 *   dpStack[h] = 只用「可叠」层型、恰好用掉高度 h 时的最大箱数
 *   答案 = max over h ( dpStack[h] + 一个「不可叠」层型（厚度 ≤ 剩余高度）的箱数 )
 * 这在小数 SKU、层型数量有限时是精确的（层列式空间内）。
 * 上界 = 同一个背包但允许「不可叠」层型当中间层（放宽约束），再和体积界、载重界取最小。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.pack && typeof require === 'function') NS.pack = require('./pack.js');
  var S = NS.shapes;

  function capacityOf(pose, c) {
    return Math.max(0, Math.floor((c.innerL + 1e-6) / pose.fx)) *
      Math.max(0, Math.floor((c.innerW + 1e-6) / pose.fy));
  }

  /** 顶面能不能继续往上叠：取真实顶面，要求覆盖整层底面且高度一致 */
  function topStackable(item, pose, p) {
    if (!NS.pack.facesRel) return true;
    var f = NS.pack.facesRel(item, pose.m, pose.fx, pose.fy, pose.thickness);
    if (!f.top || !f.top.length) return false;
    var area = 0;
    f.top.forEach(function (r) { area += r.l * r.w; });
    return area >= pose.fx * pose.fy - 1;
  }

  /** 一个 SKU 在给定容器里能贡献的所有层型（带覆盖矩形：这一层实际盖住多大底面） */
  function typesFor(item, c) {
    var out = [];
    var poses = NS.pack.posesFor(item);
    poses.forEach(function (pose) {
      if (pose.flip) return; // 倒放只在对扣里出现
      if (pose.thickness > c.doorH + 1e-6) return;
      var nx = Math.max(0, Math.floor((c.innerL + 1e-6) / pose.fx));
      var ny = Math.max(0, Math.floor((c.innerW + 1e-6) / pose.fy));
      if (nx <= 0 || ny <= 0) return;
      if (pose.thickness > c.innerH + 1e-6) return;
      var cl = nx * pose.fx;
      var cw = ny * pose.fy;
      out.push({
        skuId: item.id,
        kind: 'pose',
        pose: pose,
        thickness: pose.thickness,
        boxes: nx * ny,
        cover: { l: cl, w: cw },
        fullFloor: cl >= c.innerL - 1 && cw >= c.innerW - 1,
        stackable: topStackable(item, pose)
      });
    });
    // 对扣：每对 2 箱，顶面拼平可叠
    if (NS.pack.pairFeasible(item) && item.allowFlip) {
      var sv = item.shapeValues;
      var t = sv.hlow + sv.h;
      if (t <= c.innerH + 1e-6 && t <= c.doorH + 1e-6) {
        var nx2 = Math.max(0, Math.floor((c.innerL + 1e-6) / sv.l));
        var ny2 = Math.max(0, Math.floor((c.innerW + 1e-6) / sv.w));
        if (nx2 > 0 && ny2 > 0) {
          var cl2 = nx2 * sv.l;
          var cw2 = ny2 * sv.w;
          out.push({
            skuId: item.id, kind: 'pair', pose: null, thickness: t,
            boxes: nx2 * ny2 * 2,
            cover: { l: cl2, w: cw2 },
            fullFloor: cl2 >= c.innerL - 1 && cw2 >= c.innerW - 1,
            stackable: true
          });
        }
      }
    }
    return out;
  }

  function allTypes(items, c) {
    var out = [];
    (items || []).forEach(function (it) {
      if (!it.placeable || it.remaining <= 0) return;
      typesFor(it, c).forEach(function (t) {
        // 这个层型最多能用几次（受剩余箱数限制）
        t.maxUses = Math.max(0, Math.floor(it.remaining / t.boxes));
        if (t.maxUses > 0) out.push(t);
      });
    });
    return out;
  }

  /**
   * 高度背包 + 覆盖约束。
   * 状态 = (已用高度, 当前顶层覆盖矩形)：上面的层必须落在下面那层的覆盖范围内，否则就是悬空。
   * 先只走「可叠」层型（顶层平整），最后一层允许放一个「不可叠」层型。
   * opts.relax=true 时放宽成允许不可叠层型当中间层——只用来算上界。
   */
  function knapsack(types, innerH, opts) {
    var H = Math.floor(innerH);
    var relax = !!(opts && opts.relax);
    var NEG = -1e9;

    // 覆盖矩形去重：FULL 表示整柜底面
    var covers = [{ l: 1e9, w: 1e9, key: 'full' }];
    var coverIndex = { full: 0 };
    types.forEach(function (t) {
      var k = t.cover.l + 'x' + t.cover.w;
      if (coverIndex[k] === undefined) {
        coverIndex[k] = covers.length;
        covers.push({ l: t.cover.l, w: t.cover.w, key: k });
      }
      t.coverIdx = coverIndex[k];
    });

    var C = covers.length;
    var size = (H + 1) * C;
    var dp = new Array(size).fill(NEG);
    var prev = new Array(size).fill(null);
    dp[0 * C + 0] = 0;

    for (var h = 0; h <= H; h++) {
      for (var ci = 0; ci < C; ci++) {
        var cur = dp[h * C + ci];
        if (cur === NEG) continue;
        for (var i = 0; i < types.length; i++) {
          var t = types[i];
          if (!relax && !t.stackable) continue; // 不可叠的只能当最后一层
          if (t.cover.l > covers[ci].l + 1e-6 || t.cover.w > covers[ci].w + 1e-6) continue;
          var nh = h + Math.floor(t.thickness);
          if (nh > H) continue;
          var nci = t.coverIdx;
          var val = cur + t.boxes;
          var idx = nh * C + nci;
          if (val > dp[idx]) {
            dp[idx] = val;
            prev[idx] = { h: h, ci: ci, type: i };
          }
        }
      }
    }

    var best = { boxes: 0, height: 0, seq: [] };
    if (relax) {
      for (var h2 = 0; h2 <= H; h2++) {
        for (var c2 = 0; c2 < C; c2++) {
          var v = dp[h2 * C + c2];
          if (v > best.boxes) best = { boxes: v, height: h2, endIdx: h2 * C + c2 };
        }
      }
    } else {
      // 最后一层：任何层型都可以（不可叠的只能出现在这里）
      for (var h3 = 0; h3 <= H; h3++) {
        for (var c3 = 0; c3 < C; c3++) {
          var base = dp[h3 * C + c3];
          if (base === NEG) continue;
          var add = 0;
          var top = null;
          for (var j = 0; j < types.length; j++) {
            var tt = types[j];
            if (tt.cover.l > covers[c3].l + 1e-6 || tt.cover.w > covers[c3].w + 1e-6) continue;
            if (h3 + Math.floor(tt.thickness) > H) continue;
            if (tt.boxes > add) { add = tt.boxes; top = tt; }
          }
          if (base + add > best.boxes) {
            best = {
              boxes: base + add,
              height: h3 + (top ? Math.floor(top.thickness) : 0),
              endIdx: h3 * C + c3,
              top: top
            };
          }
        }
      }
    }

    // 回溯
    if (best.boxes > 0) {
      var seq = [];
      var idx2 = best.endIdx;
      var guard = 0;
      while (idx2 !== null && idx2 !== undefined && guard++ < 500) {
        var p = prev[idx2];
        if (!p) break;
        seq.push(types[p.type]);
        idx2 = p.h * C + p.ci;
      }
      seq.reverse();
      if (best.top) seq.push(best.top);
      best.seq = seq;
    }
    best.covers = covers.length;
    return best;
  }

  /**
   * 层列式空间内的最优（可叠层自由组合 + 一个不可叠顶层）。
   * 返回 { boxes, height, layers[] }。层型重复次数受 SKU 剩余量约束，超出的层从顶部裁掉。
   */
  function solve(items, container) {
    var types = allTypes(items, container);
    var r = knapsack(types, container.innerH, { relax: false });
    // SKU 剩余量上限：一个层型用了几次 × 每层箱数不能超过剩余
    var bySku = {};
    (items || []).forEach(function (it) { bySku[it.id] = it; });
    var used = {};
    var seq = [];
    var boxes = 0;
    var height = 0;
    r.seq.forEach(function (t) {
      var it = bySku[t.skuId];
      if (!it) return;
      var u = (used[t.skuId] || 0) + t.boxes;
      if (u > it.remaining) return; // 这个 SKU 的货不够了，这层放不了
      used[t.skuId] = u;
      seq.push(t);
      boxes += t.boxes;
      height += t.thickness;
    });
    return { boxes: boxes, height: height, layers: seq };
  }

  /** 上界：放宽「顶层」约束（不可叠层也能当中间层）+ 体积界 + 载重界，取最小 */
  function bound(items, container) {
    var types = allTypes(items, container);
    var relaxed = knapsack(types, container.innerH, { relax: true }).boxes;

    // 体积界：全用净体积最小的箱子
    var minNet = Infinity;
    var totalQty = 0;
    (items || []).forEach(function (it) {
      if (!it.placeable || it.remaining <= 0) return;
      totalQty += it.remaining;
      if (it.netVolumeEach > 0 && it.netVolumeEach < minNet) minNet = it.netVolumeEach;
    });
    var volBound = totalQty;
    if (Number.isFinite(minNet) && minNet > 0) {
      volBound = Math.floor(container.innerL * container.innerW * container.innerH / minNet) + 1;
    }

    // 载重界
    var weightBound = totalQty;
    if (items && items.length) {
      var allHaveWeight = items.every(function (it) { return it.unitWeight !== null && it.unitWeight !== undefined; });
      if (allHaveWeight) {
        var sum = 0;
        items.forEach(function (it) {
          if (!it.placeable || it.remaining <= 0) return;
          var w = it.unitWeight || 0;
          sum += w > 0 ? Math.min(it.remaining, Math.floor(container.payload / w)) : it.remaining;
        });
        weightBound = sum;
      }
    }

    var byTypes = relaxed;
    var byVolume = Math.min(totalQty, volBound);
    var byWeight = Math.min(totalQty, weightBound);
    var b = Math.min(byTypes, byVolume, byWeight);
    return {
      boxes: b,
      byTypes: byTypes,
      byVolume: byVolume,
      byWeight: byWeight
    };
  }

  NS.layerdp = { typesFor: typesFor, allTypes: allTypes, solve: solve, bound: bound };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.layerdp;
})(typeof globalThis !== 'undefined' ? globalThis : this);
