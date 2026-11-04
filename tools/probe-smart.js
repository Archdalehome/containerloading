// 探针：手动页面直接调用自动算柜引擎，确认返回结构可用
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');

const rows = [
  { id: 'a', shape: 'rect', name: '箱A', values: { L: '400', W: '300', H: '300' }, qty: 100, allowFlip: true, allowSide: true },
  { id: 'b', shape: 'lshape', name: '箱B', values: { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, qty: 20, allowFlip: true, allowSide: true }
];
const t0 = Date.now();
const pack = P.run({ container: c, rows: rows, options: {} });
const ms = Date.now() - t0;
console.log('耗时 ' + ms + 'ms');
console.log('顶层字段：' + Object.keys(pack).join(', '));
console.log('装入 ' + (pack.boxes || []).length + ' 箱');
console.log('totals: ' + JSON.stringify(pack.totals && {
  loadedCount: pack.totals.loadedCount,
  fillRate: pack.totals.fillRate
}));
const b = (pack.boxes || [])[0];
console.log('第一箱：' + JSON.stringify(b && { skuId: b.skuId, x: b.x, y: b.y, z: b.z, l: b.l, w: b.w, h: b.h, pose: b.pose }));
