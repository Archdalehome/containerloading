/*
 * 自动对扣单测：拖到附近就自动扣上（角对齐、零侵入、落 H低/H底）。
 *   node tests/auto-pair.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const SOLID = require('../js/core/solid.js');
const L = require('../js/core/corner-link.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const lshape = (id, l, w, wlow, whigh, hlow, hhigh) => ({
  id, shape: 'lshape',
  shapeValues: { l, w, h: hhigh, wlow, whigh, hlow, hhigh },
  bbox: { l, w, h: hhigh }
});
const slope = (id, l, w, hlow, hhigh) => ({
  id, shape: 'slope',
  shapeValues: { l, w, h: hhigh, hlow, hhigh },
  bbox: { l, w, h: hhigh }
});
const box = (skuId, x, y, z, l, w, h, uid) => ({ skuId, x, y, z, l, w, h, uid: uid || skuId });

console.log('\n自动对扣');

test('同款对称 L 形拖到附近：自动翻过来扣上，落 H低，角对齐 0/0', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const items = { l: it };
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const drop = box('l', 180, 120, 0, 900, 700, 600, 'L2');
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.box.x, r.box.y, r.box.z], [0, 0, 300]);
  assert.deepStrictEqual(r.residual, { dx: 0, dy: 0, dz: 0 });
  assert.strictEqual(r.pairedWith, 'L1');
});

test('自动对扣后零侵入，两块合起来是实心块', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const items = { l: it };
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const drop = box('l', 100, 100, 500, 900, 700, 600, 'L2');
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  assert.ok(r.ok, r.message);
  const depth = SOLID.overlapDepth(r.box, lower, it, it, 10);
  assert.ok(depth <= 1, '穿插 ' + depth.toFixed(1) + 'mm');
  assert.strictEqual(r.box.z + r.box.h, 900, '拼合总高应为 H低+H高=900');
});

test('同款斜顶拖到附近：自动镜像对扣，落 H底', () => {
  const it = slope('s', 2000, 470, 500, 900);
  const items = { s: it };
  const lower = box('s', 0, 0, 0, 2000, 470, 900, 'S1');
  const drop = box('s', 260, 60, 0, 2000, 470, 900, 'S2');
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 500);
  const depth = SOLID.overlapDepth(r.box, lower, it, it, 10);
  assert.ok(depth <= 1, '穿插 ' + depth.toFixed(1) + 'mm');
});

test('离得太远：不自动扣（留给普通落位）', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const items = { l: it };
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const drop = box('l', 1200, 0, 0, 900, 700, 600, 'L2');
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-pair');
});

test('不同尺寸不自动扣（扣不严）', () => {
  const items = { a: lshape('a', 900, 700, 350, 350, 300, 600), b: lshape('b', 800, 600, 300, 300, 300, 600) };
  const lower = box('a', 0, 0, 0, 900, 700, 600, 'A1');
  const drop = box('b', 50, 50, 0, 800, 600, 600, 'B1');
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  assert.strictEqual(r.ok, false);
});

test('台阶不对称的 L 形：不自动扣', () => {
  const it = lshape('l', 900, 700, 250, 450, 300, 600);
  const items = { l: it };
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const drop = box('l', 60, 60, 0, 900, 700, 600, 'L2');
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  assert.strictEqual(r.ok, false, '不对称台阶不该自动扣，实际 ' + JSON.stringify(r.box && r.box.z));
});

test('对扣位被别的箱子占着：不扣（零侵入优先）', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const items = { l: it, r: { id: 'r', shape: 'rect', shapeValues: { l: 900, w: 700, h: 300 }, bbox: { l: 900, w: 700, h: 300 } } };
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const blocker = box('r', 0, 0, 300, 900, 700, 300, 'R1');   // 正好占住配对位
  const drop = box('l', 100, 100, 0, 900, 700, 600, 'L2');
  const r = L.autoPairOnDrop(drop, [lower, blocker], c, items, { tol: 400 });
  assert.strictEqual(r.ok, false, '被占住不该硬扣');
});

test('已对扣的两只：再拖下面那只不会去扣上面那只（不会交换位置）', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const items = { l: it };
  const lower = Object.assign(box('l', 0, 0, 0, 900, 700, 600, 'L1'), { paired: true });
  const upper = Object.assign(box('l', 0, 0, 300, 900, 700, 600, 'L2'), { pinned: true, pairedWith: 'L1' });
  const dragged = box('l', 80, 60, 0, 900, 700, 600, 'L1');
  const r = L.autoPairOnDrop(dragged, [lower, upper], c, items, { tol: 400 });
  assert.strictEqual(r.ok, false, '不该再配一次对，实际 ok=' + r.ok);
});

test('exclude：把自己刚拆开的配对伙伴排除后，不会再扣回去（能拖走）', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const items = { l: it };
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const dragged = box('l', 40, 30, 300, 900, 700, 600, 'L2');
  // 不排除：会立刻扣回 L1
  const withPair = L.autoPairOnDrop(dragged, [lower], c, items, { tol: 400 });
  assert.ok(withPair.ok, '不排除时应能扣上');
  // 排除 L1：不能再扣回
  const without = L.autoPairOnDrop(dragged, [lower], c, items, { tol: 400, exclude: ['L1'] });
  assert.strictEqual(without.ok, false, '排除后不该再扣上');
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败\n');
if (fail) process.exit(1);
