// 调试：50 只斜顶 600×400 的每个方案：箱数 / 铺长 / 用高 / 是否对扣
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');
const rows = [{ id: 'a', shape: 'slope', name: '斜顶箱', values: { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, qty: 50, allowFlip: true, allowSide: true }];
const ps = P.runPlans({ container: c, rows: rows, options: {} });
(ps.ranked || []).slice(0, 6).forEach((p, i) => {
  const len = Math.max.apply(null, p.pack.placements.map((q) => q.x + q.l));
  const kinds = {};
  p.pack.placements.forEach((q) => { kinds[q.kind] = (kinds[q.kind] || 0) + 1; });
  console.log('#' + i + ' 箱 ' + p.boxes + '｜铺长 ' + Math.round(len) + '｜用高 ' + Math.round(p.pack.usedHeight) +
    '｜' + JSON.stringify(kinds));
});
