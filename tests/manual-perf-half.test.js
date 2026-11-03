/*
 * 半满场景的性能与成功路径：以自动方案装 840 只（留出空位）为起点。
 * 用户真正会用到的是「往半满的柜里再塞」，这条走的是成功路径：
 * 重叠检查要走完所有相交箱子、settle 要建支撑面。满柜那条量的是拒绝路径，别混用。
 *   node tests/manual-perf-half.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const MM = require('../js/core/manual-model.js');

const c = C.get('40HQ');
const rows = [{ id: 'a', shape: 'rect', name: '箱A', values: { L: '400', W: '300', H: '300' }, qty: '840', weight: '' }];
const pk = P.run({ container: c, rows: rows, options: {} });
const items = pk.items.map((it) => Object.assign({}, it, { remaining: it.qty, loaded: 0 }));
const s = MM.create(items, c);
pk.placements.forEach((p) => {
  s.boxes.push({
    uid: s.nextId++, skuId: p.skuId,
    x: p.x, y: p.y, z: p.z, l: p.l, w: p.w, h: p.h, pose: p.pose
  });
});
const top = s.boxes.reduce((m, b) => Math.max(m, b.z + b.h), 0);
console.log('起点：自动方案 ' + s.boxes.length + ' 只，最高顶面 ' + top + 'mm');

const t0 = Date.now();
const rounds = 20;
let ok = 0;
for (let i = 0; i < rounds; i++) {
  const r = MM.add(s, { skuId: 'a', x: 0, y: 0, z: top, l: 400, w: 300, h: 300 });
  if (r.ok) { ok++; s.boxes.pop(); }
}
const per = (Date.now() - t0) / rounds;
console.log('840 只时，单次落位判定平均 ' + per.toFixed(1) + ' ms（成功 ' + ok + '/' + rounds + '）');

assert.ok(ok > 0, '这组必须至少成功一次，否则又是在量拒绝路径');
assert.ok(per < 16, '单次判定 ' + per.toFixed(1) + ' ms 超一帧，需要加空间索引');
console.log('\nok  半满场景成功路径仍在一帧以内\n');
