// 探针：按切片装柜——每片装满再挪下一片
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');

function show(name, rows) {
  const t0 = Date.now();
  const pk = P.runSlices({ container: c, rows: rows, options: {} });
  const ms = Date.now() - t0;
  if (!pk) { console.log(name + ' → 无结果'); return; }
  const xs = pk.placements.map((p) => p.x);
  const len = Math.max.apply(null, pk.placements.map((p) => p.x + p.l));
  const wid = Math.max.apply(null, pk.placements.map((p) => p.y + p.w));
  const zs = {};
  pk.placements.forEach((p) => { zs[p.z] = (zs[p.z] || 0) + 1; });
  console.log(name + ' → 装入 ' + pk.placements.length + ' 箱｜' + ms + 'ms');
  console.log('   铺长 ' + Math.round(len) + 'mm｜用宽 ' + Math.round(wid) + 'mm｜用高 ' +
    Math.round(pk.usedHeight) + 'mm｜层高分布 ' + JSON.stringify(zs));
  console.log('   物理校验错误 ' + (P.validatePhysics(pk) || []).length + ' 条');
}

show('斜顶 600×400（300/500）×50', [{ id: 'a', shape: 'slope', name: '斜顶', values: { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, qty: 50, allowFlip: true, allowSide: true }]);
show('L 形 600×700（460/240）×10', [{ id: 'b', shape: 'lshape', name: 'L', values: { L: '600', W: '700', Wlow: '460', Whigh: '240', Hlow: '300', Hhigh: '500' }, qty: 10, allowFlip: true, allowSide: true }]);
show('矩形 400×300×300 ×100', [{ id: 'c', shape: 'rect', name: 'R', values: { L: '400', W: '300', H: '300' }, qty: 100, allowFlip: true, allowSide: true }]);
