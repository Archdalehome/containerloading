/*
 * 体积不变性：任意姿态下，采样得到的实体体积必须等于解析净体积（误差 <1%）。
 * 不依赖任何「哪根轴朝上」的分支——这一条能直接防住「侧躺被当成实心块」那类 bug。
 *   node tests/solid-volume.test.js
 */
'use strict';

const assert = require('assert');
const S = require('../js/core/solid.js');
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

const STEP = 5; // mm
let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

/** 采样体积：按容器 bbox 布点，累加每列实体高度 */
function sampledVolume(item, pose) {
  const p = {
    x: 0, y: 0, z: 0,
    l: pose.fx, w: pose.fy, h: pose.thickness,
    pose: pose.m
  };
  let vol = 0;
  for (let X = STEP / 2; X < pose.fx; X += STEP) {
    for (let Y = STEP / 2; Y < pose.fy; Y += STEP) {
      const s = S.spanAt(p, item, X, Y);
      if (!s) continue;
      vol += Math.max(0, s[1] - s[0]) * STEP * STEP;
    }
  }
  return vol;
}

function analyticVolume(item) {
  const sv = item.shapeValues;
  if (item.shape === 'lshape') return sv.l * (sv.wlow * sv.hlow + sv.whigh * sv.hhigh);
  if (item.shape === 'slope') return sv.l * sv.w * (sv.hlow + sv.hhigh) / 2;
  return sv.l * sv.w * sv.h;
}

const cases = [
  { name: '矩形 400×300×250', shape: 'rect', values: { L: '400', W: '300', H: '250' } },
  { name: 'L 形 600×400（160/240，300/500）', shape: 'lshape', values: { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' } },
  { name: '斜顶 700×500（300/600）', shape: 'slope', values: { L: '700', W: '500', Hlow: '300', Hhigh: '600' } }
];

console.log('\n体积不变性（三种箱型 × 全部可用姿态）');

cases.forEach((cs) => {
  test(cs.name + '：每个姿态的采样体积 = 解析体积（<1%）', () => {
    const item = { id: 'x', shape: cs.shape, shapeValues: null, bbox: null };
    // 借 pack 的 bbox / shapeValues 构造
    const rows = [{ id: 'x', shape: cs.shape, values: cs.values, qty: '10', allowSide: true, allowFlip: true }];
    const pk = P.run({ container: C.get('20GP'), rows: rows, options: {} });
    const it = Object.assign({}, pk.items[0], { allowSide: true, allowFlip: true });
    const want = analyticVolume(it);
    const poses = P.posesFor(it).filter((p) => !p.flip);
    assert.ok(poses.length >= 3, '姿态数太少：' + poses.length);
    let worst = 0;
    poses.forEach((pose) => {
      const got = sampledVolume(it, pose);
      const err = Math.abs(got - want) / want;
      if (err > worst) worst = err;
      assert.ok(err < 0.01,
        '姿态 fx=' + pose.fx + ' fy=' + pose.fy + ' t=' + pose.thickness +
        ' 采样 ' + (got / 1e9).toFixed(4) + ' m³ vs 解析 ' + (want / 1e9).toFixed(4) +
        ' m³，误差 ' + (err * 100).toFixed(1) + '%');
    });
    console.log('      ' + poses.length + ' 个姿态，最大误差 ' + (worst * 100).toFixed(2) + '%');
  });
});

console.log('\n' + pass + ' 通过，' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
