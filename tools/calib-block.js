/*
 * 校准：拿引擎已验证的 90 箱竖直对扣摆放喂给判定器。
 * 标准答案 0 重叠 0 空洞；两个数分开输出，便于区分「平移没对齐」与「布点错」。
 *   node tools/calib-block.js
 */
'use strict';
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const SOLID = require('../js/core/solid.js');

/** 判定两只箱子的并集是否实心长方体：在并集 bbox 内均匀布点 */
function judge(lower, upper, item, T, step) {
  const x0 = Math.min(lower.x, upper.x);
  const y0 = Math.min(lower.y, upper.y);
  const x1 = Math.max(lower.x + lower.l, upper.x + upper.l);
  const y1 = Math.max(lower.y + lower.w, upper.y + upper.w);
  const nx = Math.max(1, Math.ceil((x1 - x0) / (step || 20)));
  const ny = Math.max(1, Math.ceil((y1 - y0) / (step || 20)));
  let cols = 0, holes = 0, overlaps = 0, worstHole = 0, worstOv = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const X = x0 + (i + 0.5) * (x1 - x0) / nx;
      const Y = y0 + (j + 0.5) * (y1 - y0) / ny;
      const a = SOLID.spanAt(lower, item, X, Y);
      const b = SOLID.spanAt(upper, item, X, Y);
      if (!a && !b) { cols++; holes++; worstHole = Math.max(worstHole, T); continue; }
      cols++;
      const lo = Math.min(a ? a[0] : Infinity, b ? b[0] : Infinity);
      const hi = Math.max(a ? a[1] : -Infinity, b ? b[1] : -Infinity);
      if (Math.abs(lo) > 1 || Math.abs(hi - T) > 1) {
        holes++;
        worstHole = Math.max(worstHole, Math.abs(hi - T), Math.abs(lo));
      }
      if (a && b) {
        const ov = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
        if (ov > 1) { overlaps++; worstOv = Math.max(worstOv, ov); }
      }
    }
  }
  return {
    L: x1 - x0, W: y1 - y0, T,
    cols, holes, overlaps,
    holeRate: cols ? holes / cols : 1,
    overlapRate: cols ? overlaps / cols : 1,
    worstHole, worstOv
  };
}

// ---- 用例 1：引擎已验证的 90 箱竖直对扣（斜顶 2000×470，H低 410 / H高 900，40GP）----
const c = C.get('40GP');
const row = { id: 's', shape: 'slope', name: '', values: { L: '2000', W: '470', Hlow: '410', Hhigh: '900' }, qty: '200', weight: '', allowSide: true, allowFlip: true };
const ps = P.runPlans({ container: c, rows: [row], options: {} });
const best = ps.best.pack;
const item = best.items[0];
const lows = best.placements.filter((p) => p.kind === 'pair-lower').slice(0, 1);
const ups = best.placements.filter((p) => p.kind === 'pair-upper').slice(0, 1);
console.log('引擎最优', ps.best.boxes, '箱 ·', ps.best.config.label);
console.log('一列对扣：下件 z=%s h=%s，上件 z=%s h=%s', lows[0].z, lows[0].h, ups[0].z, ups[0].h);
const T = 410 + 900;
const r1 = judge(lows[0], ups[0], item, T, 20);
console.log('判定：底面 %s×%s，高 %s', r1.L, r1.W, r1.T);
console.log('  列 %s · 空洞率 %s%%（最大 %smm）· 重叠率 %s%%（最大 %smm）',
  r1.cols, (r1.holeRate * 100).toFixed(2), r1.worstHole.toFixed(1),
  (r1.overlapRate * 100).toFixed(2), r1.worstOv.toFixed(1));
console.log('  标准答案 0/0 → ' + (r1.holes === 0 && r1.overlaps === 0 ? '校准通过' : '校准不过'));
