/*
 * 角点对位单测：点两个角 → 让这两个角严格重合 → 物理校验。
 *   node tests/corner-link.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const L = require('../js/core/corner-link.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const rect = (id, l, w, h) => ({ id, shape: 'rect', shapeValues: { l, w, h }, bbox: { l, w, h } });
const lshape = (id, l, w, wlow, whigh, hlow, hhigh) => ({
  id, shape: 'lshape',
  shapeValues: { l, w, h: hhigh, wlow, whigh, hlow, hhigh },
  bbox: { l, w, h: hhigh }
});
const box = (skuId, x, y, z, l, w, h, uid) => ({ skuId, x, y, z, l, w, h, uid: uid || skuId });

console.log('\n角点对位');

test('角点：外接框 8 角 + L 形真实台阶角', () => {
  const it = lshape('l', 900, 700, 300, 400, 300, 600);
  const b = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const cs = L.cornersOf(b, it);
  assert.strictEqual(cs.filter((q) => q.kind === 'bbox').length, 8, 'bbox 角应 8 个');
  const step = cs.filter((q) => q.kind === 'face' && Math.abs(q.z - 300) < 1);
  assert.strictEqual(step.length, 4, '低段台阶顶面应给出 4 个角，实际 ' + step.length);
  assert.ok(cs.some((q) => Math.abs(q.x - 0) < 1 && Math.abs(q.y) < 1 && Math.abs(q.z - 300) < 1), '台阶角 (0,0,300) 必须在');
});

test('同尺寸对叠：底角贴顶角，残差 0/0/0，落到底箱顶面', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const a = box('a', 0, 0, 0, 400, 300, 300, 'A1');
  const b = box('a', 5000, 0, 0, 400, 300, 300, 'B1');
  const r = L.link(b, { x: 5000, y: 0, z: 0 }, a, { x: 0, y: 0, z: 300 }, [a], c, items);
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.box.x, r.box.y, r.box.z], [0, 0, 300]);
  assert.deepStrictEqual(r.residual, { dx: 0, dy: 0, dz: 0 });
  assert.strictEqual(r.contact.ratio, 1, '底面应被完整托住');
});

test('L 形低段：上件底角贴台阶角，正好落在台阶上（不悬空）', () => {
  const items = {
    l: lshape('l', 900, 700, 300, 400, 300, 600),
    a: rect('a', 300, 300, 300)
  };
  const low = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const up = box('a', 4000, 4000, 0, 300, 300, 300, 'A1');
  const r = L.link(up, { x: 4000, y: 4000, z: 0 }, low, { x: 0, y: 0, z: 300 }, [low], c, items);
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.box.x, r.box.y, r.box.z], [0, 0, 300]);
  assert.deepStrictEqual(r.residual, { dx: 0, dy: 0, dz: 0 });
  assert.strictEqual(r.contact.ratio, 1, '台阶顶面应完整托住 300×300 的底面');
});

test('尺寸不同：小箱的角贴大箱顶角，重合且不重叠', () => {
  const items = { big: rect('big', 800, 600, 400), small: rect('small', 300, 300, 300) };
  const big = box('big', 0, 0, 0, 800, 600, 400, 'G1');
  const sm = box('small', 3000, 0, 0, 300, 300, 300, 'S1');
  const r = L.link(sm, { x: 3300, y: 300, z: 0 }, big, { x: 800, y: 600, z: 400 }, [big], c, items);
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.box.x, r.box.y, r.box.z], [500, 300, 400]);
  assert.deepStrictEqual(r.residual, { dx: 0, dy: 0, dz: 0 });
});

test('重叠：角对角把人塞进已有箱体，必须拒绝', () => {
  const items = { a: rect('a', 400, 300, 300), s: rect('s', 200, 200, 200) };
  const a = box('a', 0, 0, 0, 400, 300, 300, 'A1');
  const s = box('s', 2000, 0, 0, 200, 200, 200, 'S1');
  const r = L.link(s, { x: 2000, y: 0, z: 0 }, a, { x: 0, y: 0, z: 0 }, [a], c, items);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'overlap');
});

test('悬空：角贴着空中的顶角、下方没东西托，必须拒绝而不是飘着', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const a = box('a', 0, 0, 0, 400, 300, 300, 'A1');
  const b = box('a', 4000, 0, 0, 400, 300, 300, 'B1');
  const r = L.link(b, { x: 4000, y: 0, z: 0 }, a, { x: 400, y: 0, z: 300 }, [a], c, items);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-support', '应报悬空，实际 ' + r.reason);
});

test('越界：大箱的角贴柜尾小箱的角，必须拒绝', () => {
  const items = { a: rect('a', 400, 300, 300), b: rect('bb', 800, 600, 400) };
  const a = box('a', c.innerL - 400, 0, 0, 400, 300, 300, 'A1');
  const b = box('bb', 0, 0, 0, 800, 600, 400, 'B1');
  const r = L.link(b, { x: 0, y: 0, z: 0 }, a, { x: c.innerL, y: 0, z: 0 }, [a], c, items);
  assert.strictEqual(r.ok, false, '应越界被拒');
  assert.strictEqual(r.reason, 'bounds', '实际 ' + r.reason);
});

test('不合法时不动原坐标（link 不就地改入参）', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const a = box('a', 0, 0, 0, 400, 300, 300, 'A1');
  const b = box('a', 4000, 0, 0, 400, 300, 300, 'B1');
  const before = Object.assign({}, b);
  L.link(b, { x: 4000, y: 0, z: 0 }, a, { x: 400, y: 0, z: 300 }, [a], c, items);
  assert.deepStrictEqual(b, before);
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败\n');
if (fail) process.exit(1);
