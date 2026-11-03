/*
 * 参考解（层型背包）必须自己也过得去物理校验。
 *
 * 为什么单独立一条：层型背包只做尺寸和高度运算，它说「这层能叠」不代表箱子真放得上去。
 * 704×482 的参考解原来是 4 层正放 L 形叠一起——第二层起每只箱子有一半悬在台阶缺口上方
 * （137mm），背包看不出来。拿这种解去当引擎的对照，会把对的引擎改成错的。
 *
 *   node tests/ref-physics.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const D = require('../js/core/layerdp.js');
const R = require('../tools/ref-check.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name);
    console.log('      ' + e.message);
  }
}

console.log('\n参考解物理校验（层型背包的结果必须真放得上去）');

R.CASES.forEach((cs) => {
  test(cs.name + '：参考解逐箱有支撑、不穿插、不越界', () => {
    const c = C.get('40HQ');
    const row = {
      id: 'a', shape: 'lshape', name: '', values: cs.values,
      qty: '2000', weight: '', allowSide: true, allowFlip: true
    };
    const pk = P.run({ container: c, rows: [row], options: { allowFill: false, sortBy: 'volume' } });
    const ref = D.solve(pk.items, c);
    assert.ok(ref.boxes > 0, '参考解不能是 0 箱');
    const r = R.check(pk.items, c, ref.layers);
    assert.strictEqual(r.errs.outOfBounds.length, 0, '参考解有箱子出界');
    assert.strictEqual(r.errs.overlap.length, 0, '参考解有箱子实体穿插');
    assert.strictEqual(r.errs.unsupported.length, 0,
      '参考解有 ' + r.errs.unsupported.length + ' 只箱子悬空（首个 z=' +
      (r.errs.unsupported[0] || {}).z + 'mm，最大空隙 ' + (r.errs.unsupported[0] || {}).worstGap + 'mm）');
  });
});

test('正放 L 形不算「顶面平整」：台阶面比顶面低，上层会悬空', () => {
  const c = C.get('40HQ');
  const row = {
    id: 'a', shape: 'lshape', name: '',
    values: { L: '704', W: '482', Wlow: '155', Whigh: '327', Hlow: '479', Hhigh: '616' },
    qty: '100', weight: '', allowSide: true, allowFlip: true
  };
  const pk = P.run({ container: c, rows: [row], options: { allowFill: false, sortBy: 'volume' } });
  const it = pk.items[0];
  const upright = P.posesFor(it).filter((p) => p.vertical === 2);
  assert.ok(upright.length > 0, '正放姿态应该存在');
  upright.forEach((p) => {
    assert.strictEqual(P.poseStackable(it, p), false, '正放 L 形不能判成可叠（台阶低 ' + (it.shapeValues.h - it.shapeValues.hlow) + 'mm）');
  });
  const side = P.posesFor(it).filter((p) => p.vertical !== 2);
  assert.ok(side.some((p) => P.poseStackable(it, p)), '侧放后顶面是完整平面，至少有一个姿态应判成可叠');
});

console.log('\n' + pass + ' 通过，' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
