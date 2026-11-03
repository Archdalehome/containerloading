/*
 * 手动模式真实规模：以自动方案（40HQ 400×300×300 满柜）为起点，场景里已有 1680 只。
 * 手动落位判定要在这 1680 只里查支撑与重叠，是手动模式性能的真实上限。
 *   node tests/manual-perf-1680.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const MM = require('../js/core/manual-model.js');

const c = C.get('40HQ');
const rows = [{ id: 'a', shape: 'rect', name: '箱A', values: { L: '400', W: '300', H: '300' }, qty: '1680', weight: '' }];
const pk = P.run({ container: c, rows: rows, options: {} });
const items = pk.items.map((it) => Object.assign({}, it, { remaining: it.qty, loaded: 0 }));
const s = MM.create(items, c);
pk.placements.forEach((p, i) => {
  s.boxes.push({
    uid: s.nextId++, skuId: p.skuId,
    x: p.x, y: p.y, z: p.z, l: p.l, w: p.w, h: p.h, pose: p.pose
  });
});
console.log('起点：自动方案 ' + s.boxes.length + ' 只');

const t0 = Date.now();
const rounds = 20;
let ok = 0;
for (let i = 0; i < rounds; i++) {
  const r = MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  if (r.ok) { ok++; s.boxes.pop(); }
}
const per = (Date.now() - t0) / rounds;
console.log('1680 只时，单次落位判定平均 ' + per.toFixed(1) + ' ms（成功 ' + ok + '/' + rounds + '）');
assert.ok(per < 16, '单次判定 ' + per.toFixed(1) + ' ms 超一帧，需要加空间索引');
console.log('\nok  1680 只时单次判定仍在一帧以内\n');
