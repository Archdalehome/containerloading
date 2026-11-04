  /**
   * 单一 SKU 的"列装箱"最优解：把柜宽×柜高看成一列，一列能塞 c 个、占柜长 fx。
   * 这就是"用最短柜长装够 q 个"的完全背包（可混用不同姿态的列），给出可证明的最短柜长。
   * 只处理单 SKU；混装交给主引擎。没有可行解返回 null。
   */
  function optimalColumns(rows, container) {
    var list = (rows || []).filter(function (r) { return S.toNum(r.qty) > 0; });
    if (list.length !== 1 || !container) return null;
    var r = list[0];
    var shape = S.get(r.shape);
    var v = r.values || {};
    var bb = shape.bbox(v);
    if (!(bb.l > 0 && bb.w > 0 && bb.h > 0)) return null;
    var sv = r.shape === 'lshape'
      ? { l: S.toNum(v.L), w: bb.w, h: bb.h, wlow: S.toNum(v.Wlow), whigh: S.toNum(v.Whigh), hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
      : r.shape === 'slope'
        ? { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h, hlow: S.toNum(v.Hlow), hhigh: S.toNum(v.Hhigh) }
        : { l: S.toNum(v.L), w: S.toNum(v.W), h: bb.h };
    var item = {
      id: r.id, index: 0, shape: r.shape, name: r.name || r.id,
      values: v, bbox: bb, shapeValues: sv,
      qty: S.toNum(r.qty), loaded: 0,
      allowFlip: r.allowFlip !== false, allowSide: r.allowSide !== false
    };
    var q = S.toNum(r.qty);
    if (!(q > 0)) return null;
    var poses = posesFor(item).filter(function (p) { return p.thickness <= container.doorH + 1e-6; });
    if (!poses.length) return null;
    var cols = poses.map(function (p) {
      var ny = Math.floor((container.innerW + 1e-6) / p.fy);
      var layers = Math.floor((container.innerH + 1e-6) / p.thickness);
      return { pose: p, ny: ny, layers: layers, c: Math.max(0, ny * layers), cost: p.fx };
    }).filter(function (c) { return c.c > 0; });
    if (!cols.length) return null;
    var INF = Infinity;
    var dp = new Array(q + 1);
    var from = new Array(q + 1);
    dp[0] = 0;
    for (var k = 1; k <= q; k++) dp[k] = INF;
    for (var k2 = 1; k2 <= q; k2++) {
      for (var i = 0; i < cols.length; i++) {
        var c0 = cols[i].c;
        var prev = Math.max(0, k2 - c0);
        if (dp[prev] === INF) continue;
        var val = dp[prev] + cols[i].cost;
        if (val < dp[k2]) { dp[k2] = val; from[k2] = { i: i, prev: prev }; }
      }
    }
    if (dp[q] === INF) return null;
    var picks = [];
    var cur = q;
    var guard = 0;
    while (cur > 0 && from[cur] && guard++ < 10000) {
      picks.push(cols[from[cur].i]);
      cur = from[cur].prev;
    }
    var placements = [];
    var x = 0;
    var left = q;
    picks.forEach(function (col) {
      var p = col.pose;
      for (var li = 0; li < col.layers && left > 0; li++) {
        for (var yi = 0; yi < col.ny && left > 0; yi++) {
          placements.push({
            skuId: item.id, index: 0, col: yi + 1, row: li + 1,
            x: x, y: yi * p.fy, z: li * p.thickness,
            l: p.fx, w: p.fy, h: p.thickness,
            rot: p.fx === bb.l ? 0 : 90,
            layer: li, pose: p.m,
            kind: p.side ? 'side' : (p.flip ? 'flip' : 'normal')
          });
          left--;
        }
      }
      x += p.fx;
    });
    var length = 0;
    placements.forEach(function (p) { length = Math.max(length, p.x + p.l); });
    var net = placements.length * shape.volume(v);
    return {
      ok: true, container: container, rows: rows, items: [item],
      placements: placements, layers: [],
      usedHeight: placements.reduce(function (m, p) { return Math.max(m, p.z + p.h); }, 0),
      containerVolume: container.innerL * container.innerW * container.innerH,
      totals: {
        loadedCount: placements.length,
        remainingCount: Math.max(0, q - placements.length),
        netVolume: net,
        fillRate: net / (container.innerL * container.innerW * container.innerH)
      },
      length: length
    };
  }

