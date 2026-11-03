/*
 * 手动画布的性能底线：100 只箱子时，落位判定（tryPlace）不能拖慢到用户能感觉出来。
 * 拖动中只改 transform，判定只在松手时发生，所以这里量的是「一次落位」的耗时。
 *   node tests/manual-perf.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const MM = require('../js/core/manual-model.js');

const c = C.get('40HQ');
const items = [
  { id: 'a', shape: 'rect', name: '箱A', qty: 500, shapeValues: { l: 400, w: 300, h: 300 }, bbox: { l: 400, w: 300, h: 300 } }
];
const s = MM.create(items, c);

// 摆 100 只：一层 25×2 = 50 只，再叠一层
for (let layer = 0; layer < 2 && s.boxes.length < 100; layer++) {
  for (let i = 0; i < 25 && s.boxes.length < 100; i++) {
    for (let j = 0; j < 2 && s.boxes.length < 100; j++) {
      MM.add(s, { skuId: 'a', x: i * 480, y: j * 340, z: layer * 300, l: 400, w: 300, h: 300 });
    }
  }
}
console.log('已放 ' + s.boxes.length + ' 只');

const t0 = Date.now();
let rounds = 0;
for (let i = 0; i < 20; i++) {
  const r = MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  rounds++;
  if (r.ok) s.boxes.pop(); // 只量判定，不留箱子
}
const per = (Date.now() - t0) / rounds;
console.log('100 只箱子时，单次落位判定平均 ' + per.toFixed(1) + ' ms');

assert.ok(per < 16, '单次判定 ' + per.toFixed(1) + ' ms 超过一帧（16ms），拖动松手会感到顿');
console.log('\nok  100 只时单次判定在一帧以内\n');
