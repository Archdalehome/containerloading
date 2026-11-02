'use strict';
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const E = require('../js/core/explain.js');
const m3 = (v) => (v / 1e9).toFixed(2);

function run(state) {
  const ps = P.runPlans(state);
  const pack = ps.best.pack;
  pack.planSet = ps;
  return { ps, pack, sp: E.space(pack), why: E.stopText(pack), un: E.unlocks(state, pack, ps) };
}

const combos = [
  [false, false, false], [false, false, true],
  [true, false, false], [true, false, true],
  [false, true, false], [true, true, true]
];

combos.forEach(([side, flip, dun]) => {
  const state = {
    container: C.get('40GP'),
    rows: [{
      id: 'l', shape: 'lshape', name: 'L形',
      values: { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' },
      qty: '1000', weight: '', allowSide: side, allowFlip: flip
    }],
    options: { allowDunnage: dun }
  };
  const r = run(state);
  const label = '侧放' + (side ? '开' : '关') + ' · 倒放' + (flip ? '开' : '关') + ' · 垫块' + (dun ? '开' : '关');
  console.log('=== ' + label + ' → ' + r.pack.totals.loadedCount + ' 箱，' +
    (r.pack.totals.fillRate * 100).toFixed(1) + '%，' + r.pack.layers.length + ' 层，每层 ' +
    r.pack.layers[0].count + ' 箱' + (dun ? '，垫块 ' + (r.pack.dunnage || []).length + ' 块' : ''));
  console.log('  为什么停：' + r.why.base);
  r.why.items.forEach((i) => console.log('   · ' + i.name + ' 剩 ' + i.remaining + '：' + i.why));
  console.log('  空间：剩余 ' + m3(r.sp.remaining) + ' m³ = 可承重 ' + m3(r.sp.bearing) +
    ' + 不可承重 ' + m3(r.sp.nonBearing) + '（斜面 ' + m3(r.sp.slopeTop) + ' / 顶面零碎 ' +
    m3(r.sp.fragment) + ' / 高度不足 ' + m3(r.sp.heightShort) + '）');
  if (r.un.length) console.log('  解锁：' + r.un.map((u) => u.label + '→' + u.boxes + ' 箱').join('；'));
});

// 302 箱输入会怎样
const s302 = {
  container: C.get('40GP'),
  rows: [{ id: 'l', shape: 'lshape', name: 'L形', values: { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, qty: '302', weight: '', allowSide: false, allowFlip: false }],
  options: {}
};
const r302 = run(s302);
console.log('\n=== 输入 302 箱（默认开关）→ 装 ' + r302.pack.totals.loadedCount + '，净体积 ' +
  (r302.pack.totals.netVolume / 1e9).toFixed(3) + ' m³，装载率 ' + (r302.pack.totals.fillRate * 100).toFixed(1) + '%');
