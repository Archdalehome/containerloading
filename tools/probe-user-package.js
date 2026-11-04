// 复现用户那单：斜顶 1200×1000（300/500）×80 + L 形 600×400（160/240）×10
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');

const rows = [
  { id: 'a', shape: 'slope', name: '斜顶箱', values: { L: '1200', W: '1000', Hlow: '300', Hhigh: '500' }, qty: 80, allowFlip: true, allowSide: true },
  { id: 'b', shape: 'lshape', name: 'L形箱', values: { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, qty: 10, allowFlip: true, allowSide: true }
];

const t0 = Date.now();
const pack = P.run({ container: c, rows, options: {} });
const ms = Date.now() - t0;
const vol = c.innerL * c.innerW * c.innerH;
console.log('耗时 ' + ms + 'ms');
console.log('装入 ' + pack.placements.length + ' 箱（斜顶 ' + pack.items.filter((i) => i.shape === 'slope').reduce((s, i) => s + i.loaded, 0) + '）');
console.log('装载率(净体积) ' + (pack.totals.fillRate * 100).toFixed(1) + '%');
console.log('用高 ' + Math.round(pack.usedHeight) + 'mm / 柜内高 ' + c.innerH);
const layers = {};
pack.placements.forEach((p) => { layers[p.z] = (layers[p.z] || 0) + 1; });
console.log('各层高度与箱数：' + JSON.stringify(layers));
console.log('层数记录 ' + (pack.layers ? pack.layers.length : 0));
