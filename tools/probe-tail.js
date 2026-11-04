// 看 10 只 L 形箱（600×700，台阶 460/240）在不同方案里铺多长：验证"柜尾装满"能否更好
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');

const rows = [{
  id: 'a', shape: 'lshape', name: 'L形箱',
  values: { L: '600', W: '700', Wlow: '460', Whigh: '240', Hlow: '300', Hhigh: '500' },
  qty: 10, allowFlip: true, allowSide: true
}];

const ps = P.runPlans({ container: c, rows: rows, options: {} });
const ranked = (ps.ranked || []).filter((p) => p.valid && !p.gated);
console.log('有效方案 ' + ranked.length + ' 个');
ranked.slice(0, 8).forEach((p, i) => {
  const len = Math.max.apply(null, p.pack.placements.map((q) => q.x + q.l));
  const wid = Math.max.apply(null, p.pack.placements.map((q) => q.y + q.w));
  console.log('#' + i + ' [' + (p.config && p.config.key) + '] 箱数 ' + p.boxes +
    '｜铺长 ' + Math.round(len) + 'mm｜用宽 ' + Math.round(wid) + 'mm｜用高 ' +
    Math.round(p.pack.usedHeight) + 'mm');
});
