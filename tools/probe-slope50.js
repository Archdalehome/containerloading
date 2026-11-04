// 复现：斜顶 600×400（H底300/H高500）×50，看它为什么只铺一层
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');
const rows = [{ id: 'a', shape: 'slope', name: '斜顶箱', values: { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, qty: 50, allowFlip: true, allowSide: true }];
const pk = P.run({ container: c, rows: rows, options: {} });
const byZ = {};
pk.placements.forEach((p) => { byZ[p.z] = (byZ[p.z] || 0) + 1; });
console.log('装入 ' + pk.placements.length + ' 箱，用高 ' + Math.round(pk.usedHeight));
console.log('层高分布 ' + JSON.stringify(byZ));
const kinds = {};
pk.placements.forEach((p) => { kinds[p.kind] = (kinds[p.kind] || 0) + 1; });
console.log('kind 分布 ' + JSON.stringify(kinds));
const len = Math.max.apply(null, pk.placements.map((p) => p.x + p.l));
const wid = Math.max.apply(null, pk.placements.map((p) => p.y + p.w));
console.log('铺长 ' + Math.round(len) + 'mm｜用宽 ' + Math.round(wid) + 'mm');
