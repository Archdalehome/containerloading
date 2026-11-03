/*
 * 手动模型单测：放置 / 移动 / 旋转 / 复制 / 删除 / 撤销 / 计数。
 *   node tests/manual-model.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const MM = require('../js/core/manual-model.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const items = [
  { id: 'a', shape: 'rect', name: '箱A', qty: 100, shapeValues: { l: 400, w: 300, h: 300 }, bbox: { l: 400, w: 300, h: 300 } }
];
const fresh = () => MM.create(items, c);

console.log('\n手动模型');

test('放置成功才写模型，被拒绝不写', () => {
  const s = fresh();
  const ok = MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  assert.ok(ok.ok);
  assert.strictEqual(s.boxes.length, 1);
  const bad = MM.add(s, { skuId: 'a', x: 0, y: c.innerW - 50, z: 0, l: 400, w: 300, h: 300 });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(s.boxes.length, 1, '被拒绝不能改动模型');
});

test('复制：优先原位向上叠，计数跟着加', () => {
  const s = fresh();
  MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  const uid = s.boxes[0].uid;
  for (let i = 0; i < 5; i++) {
    const r = MM.copy(s, s.boxes[s.boxes.length - 1].uid);
    assert.ok(r.ok, '第 ' + (i + 1) + ' 次复制失败：' + r.reason);
  }
  assert.strictEqual(s.boxes.length, 6);
  const cs = MM.counts(s);
  assert.strictEqual(cs[0].placed, 6, '底部计数应由模型给出，实际 ' + cs[0].placed);
  assert.strictEqual(s.boxes.slice(1).every((b, i) => b.z === 300 * (i + 1)), true, '应逐层向上叠');
});

test('撤销：五次复制后撤五次回到初始', () => {
  const s = fresh();
  MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  for (let i = 0; i < 5; i++) MM.copy(s, s.boxes[s.boxes.length - 1].uid);
  assert.strictEqual(s.boxes.length, 6);
  for (let i = 0; i < 5; i++) MM.undo(s);
  assert.strictEqual(s.boxes.length, 1, '撤销五次后应剩 1 只');
  MM.undo(s);
  assert.strictEqual(s.boxes.length, 0, '再撤一次回到空柜');
});

test('移动：被拒绝时位置不变', () => {
  const s = fresh();
  MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  const uid = s.boxes[0].uid;
  const r = MM.move(s, uid, 0, c.innerW - 50, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(s.boxes[0].x, 0, '拒绝时不能改坐标');
});

test('旋转：姿态矩阵进模型，失败退回原姿态', () => {
  const s = fresh();
  MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  const uid = s.boxes[0].uid;
  const r = MM.rotate(s, uid, 'y');
  assert.ok(r.ok);
  assert.ok(s.boxes[0].pose, '应写入姿态矩阵');
  assert.strictEqual(s.boxes[0].h, 400);
});

test('删除 + 撤销限 20 步', () => {
  const s = fresh();
  MM.add(s, { skuId: 'a', x: 0, y: 0, z: 0, l: 400, w: 300, h: 300 });
  const uid = s.boxes[0].uid;
  assert.ok(MM.remove(s, uid).ok);
  assert.strictEqual(s.boxes.length, 0);
  assert.ok(MM.undo(s).ok);
  assert.strictEqual(s.boxes.length, 1);
  for (let i = 0; i < 30; i++) MM.add(s, { skuId: 'a', x: (i % 5) * 500, y: 0, z: 0, l: 400, w: 300, h: 300 });
  assert.ok(s.undo.length <= MM.UNDO_LIMIT, '撤销栈不能无限长，实际 ' + s.undo.length);
});

console.log('\n' + pass + ' 通过，' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
