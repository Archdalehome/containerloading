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

  /**
   * 顶面能不能继续往上叠：所有承重面必须都在本层层厚的高度上、且盖满整层底面。
   * 直接复用引擎的 poseStackable，避免两边各有一份口径（正放 L 的台阶面比顶面低，
   * 只按面积求和会把「台阶 + 顶面」当成一整块平顶，704×482 的参考解就是这么算错的）。
   *
   * 斜顶单只例外：不论正放还是侧放，上方一律不许压箱（物理红线：斜顶单只只能放一层）。
   * 侧放后顶面虽然是平面，但箱体自身是楔形，压上去会沿着斜面挤出；
   * validatePhysics 的 slope-top-loaded 就是这么判的，层型这边必须同一口径。
   */
  function topStackable(item, pose) {
    if (!NS.pack.poseStackable) return true;
    return NS.pack.poseStackable(item, pose);
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
        stackable: topStackable(item, pose),
        stripCap: stripCapacity(item, pose, c, nx, ny)
      });
    });
    // 对扣：每对 2 箱，顶面拼平可叠。
    // 两个水平朝向都要算：770×700 的 L 形，770 沿柜长是 15×3=45 对，
    // 转 90° 后 700 沿柜长是 17×3=51 对——只取第一个朝向会少 12 箱/层。
    if (NS.pack.pairFeasible(item) && item.allowFlip) {
      var sv = item.shapeValues;
      var t = sv.hlow + sv.h;
      if (t <= c.innerH + 1e-6 && t <= c.doorH + 1e-6) {
        [{ l: sv.l, w: sv.w }, { l: sv.w, w: sv.l }].forEach(function (f) {
          var nx2 = Math.max(0, Math.floor((c.innerL + 1e-6) / f.l));
          var ny2 = Math.max(0, Math.floor((c.innerW + 1e-6) / f.w));
          if (nx2 <= 0 || ny2 <= 0) return;
          // 对扣层要能真正落位：底件用同朝向的正放姿态，上件是它的镜像翻转件
          var lower = null;
          (NS.pack.posesFor(item) || []).forEach(function (p) {
            if (lower) return;
            if (p.flip || p.vertical !== 2) return;
            if (Math.abs(p.fx - f.l) > 1e-6 || Math.abs(p.fy - f.w) > 1e-6) return;
            lower = p;
          });
          if (!lower) return;
          var upper = NS.pack.findFlipPose ? NS.pack.findFlipPose(item, lower) : null;
          if (!upper) return;
          var cl2 = nx2 * f.l;
          var cw2 = ny2 * f.w;
          out.push({
            skuId: item.id, kind: 'pair', pose: null, thickness: t,
            boxes: nx2 * ny2 * 2,
            cover: { l: cl2, w: cw2 },
            fullFloor: cl2 >= c.innerL - 1 && cw2 >= c.innerW - 1,
            stackable: true,
            pair: { lower: lower, upper: upper, nx: nx2, ny: ny2 },
            stripCap: stripCapacity(item, { fx: f.l, fy: f.w }, c, nx2, ny2)
          });
        });
      }
    }
    return out;
  }

  /**
   * 条带最多还能塞几只（宽松估计，**只给上界用**）：
   * 两条余带面积 ÷ 该 SKU 最小底面，向上取整。宁可高估——上界只要求「不低于真最优」，
   * 可行解里条带箱要走引擎的逐箱支撑检查，不能拿这个估数当结果。
   */
  function stripCapacity(item, pose, c, nx, ny) {
    var restX = c.innerL - nx * pose.fx;
    var restY = c.innerW - ny * pose.fy;
    if (restX <= 1 && restY <= 1) return 0;
    // 只在「同款箱真有姿态能放进条带、且不高于本层层厚」时才估条带容量；
    // 否则算出来的是高估，会把上界撑松（甚至撑到体积界）。
    var best = 0;
    (NS.pack.posesFor(item) || []).forEach(function (p) {
      if (p.flip) return;
      if (p.thickness > pose.thickness + 1e-6) return;
      var cnt = 0;
      if (p.fx <= restX + 1e-6) cnt = Math.max(cnt, Math.floor(restX / p.fx) * Math.floor(c.innerW / p.fy));
      if (p.fy <= restY + 1e-6) cnt = Math.max(cnt, Math.floor(c.innerL / p.fx) * Math.floor(restY / p.fy));
      if (p.fx <= restY + 1e-6) cnt = Math.max(cnt, Math.floor(restY / p.fx) * Math.floor(c.innerL / p.fy));
      if (p.fy <= restX + 1e-6) cnt = Math.max(cnt, Math.floor(c.innerL / p.fy) * Math.floor(restX / p.fx));
      if (cnt > best) best = cnt;
    });
    return best;
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
    var ignoreCover = !!(opts && opts.ignoreCover);
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
          if (!ignoreCover && (t.cover.l > covers[ci].l + 1e-6 || t.cover.w > covers[ci].w + 1e-6)) continue;
          var nh = h + Math.floor(t.thickness);
          if (nh > H) continue;
          var nci = t.coverIdx;
          var val = cur + t.boxes + (relax ? (t.stripCap || 0) : 0);
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
            if (!ignoreCover && (tt.cover.l > covers[c3].l + 1e-6 || tt.cover.w > covers[c3].w + 1e-6)) continue;
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
   * 层列式空间内的最优：记忆化搜索 best(已用高度, 当前覆盖矩形, 各 SKU 剩余量)。
   *
   * 为什么不用高度背包：背包把「同一层型用几次」当无约束，事后按 SKU 剩余量裁掉超量层——
   * 那会先找到「264 箱最优路径」（斜顶只有 190 箱），再在回溯时悄悄砍成 162，
   * 得到的数既不是最优也不可行。用量必须进搜索状态。
   *
   * 柜内最多 9 层（2698 / 最小层厚 300），状态很浅；再把 (已用高度, 覆盖矩形, 剩余量)
   * 当记忆化键，同一状态的重复层序排列只算一次，不会因为「先放 A 再放 B」和「先 B 后 A」炸开。
   */
  function solve(items, container, opts) {
    var types = allTypes(items, container);
    var H = Math.floor(container.innerH);
    var ids = [];
    var rem0 = {};
    (items || []).forEach(function (it) {
      if (ids.indexOf(it.id) < 0) ids.push(it.id);
      rem0[it.id] = it.remaining;
    });
    var memo = Object.create(null);
    var nodes = 0;
    var nodeCap = (opts && opts.nodeCap) || 200000;

    function remSig(rem) {
      var s = '';
      for (var i = 0; i < ids.length; i++) s += rem[ids[i]] + ',';
      return s;
    }

    function best(h, cl, cw, rem) {
      var k = h + '|' + cl + 'x' + cw + '|' + remSig(rem);
      var hit = memo[k];
      if (hit) return hit;
      nodes++;
      var out = { boxes: 0, height: 0, layers: [] };
      var hLeft = H - h;
      if (hLeft > 0 && nodes <= nodeCap) {
        for (var i = 0; i < types.length; i++) {
          var t = types[i];
          if (rem[t.skuId] < t.boxes) continue;
          if (t.thickness > hLeft + 1e-6) continue;
          if (t.cover.l > cl + 1e-6 || t.cover.w > cw + 1e-6) continue;
          var sub = { boxes: 0, height: 0, layers: [] };
          if (t.stackable) {
            // 只有顶面平整的层型才能继续往上叠
            var r2 = Object.assign({}, rem);
            r2[t.skuId] -= t.boxes;
            sub = best(h + t.thickness, t.cover.l, t.cover.w, r2);
          }
          var tot = t.boxes + sub.boxes;
          if (tot > out.boxes) {
            out = { boxes: tot, height: t.thickness + sub.height, layers: [t].concat(sub.layers) };
          }
        }
      }
      memo[k] = out;
      return out;
    }

    var r = best(0, 1e9, 1e9, rem0);
    r.nodes = nodes;
    r.truncated = nodes > nodeCap;
    return r;
  }


  /** 上界：放宽「顶层」约束（不可叠层也能当中间层）+ 体积界 + 载重界，取最小 */
  function bound(items, container) {
    var types = allTypes(items, container);
    var relaxed = knapsack(types, container.innerH, { relax: true, ignoreCover: true }).boxes;

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
