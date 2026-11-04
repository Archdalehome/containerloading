// 探针：混装场景下，主引擎 / 48 枚举方案 / 分箱列块 三者装得怎么样
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

const cases = [
  {
    name: 'L 形 2300×940 ×20 + 矩形 600×400×400 ×100',
    rows: [
      { id: 'a', shape: 'lshape', name: 'L形大件', qty: '20', values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 }, allowFlip: true, allowSide: true },
      { id: 'b', shape: 'rect', name: '小箱', qty: '100', values: { L: 600, W: 400, H: 400 }, allowFlip: true, allowSide: true }
    ]
  },
  {
    name: '斜顶 1200×470 ×30 + 矩形 500×400×300 ×60',
    rows: [
      { id: 'a', shape: 'slope', name: '斜顶', qty: '30', values: { L: 1200, W: 470, Hlow: 500, Hhigh: 900 }, allowFlip: true, allowSide: true },
      { id: 'b', shape: 'rect', name: '小箱', qty: '60', values: { L: 500, W: 400, H: 300 }, allowFlip: true, allowSide: true }
    ]
  },
  {
    name: '两种大箱：L 2300×940 ×12 + L 1800×800 ×15',
    rows: [
      { id: 'a', shape: 'lshape', name: 'L大', qty: '12', values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 }, allowFlip: true, allowSide: true },
      { id: 'b', shape: 'lshape', name: 'L中', qty: '15', values: { L: 1800, Wlow: 400, Whigh: 400, Hlow: 400, Hhigh: 700 }, allowFlip: true, allowSide: true }
    ]
  }
];

function len(pk) { let m = 0; (pk.placements || []).forEach((p) => { m = Math.max(m, p.x + p.l); }); return m; }

['40HQ', '20GP'].forEach((ck) => {
  const c = C.get(ck);
  console.log('\n=== ' + ck + ' ===');
  cases.forEach((cs) => {
    const t0 = Date.now();
    const run = P.run({ container: c, rows: cs.rows, options: {} });
    const mix = P.runColumnMix(cs.rows, c);
    const plans = P.runPlans({ container: c, rows: cs.rows, options: {} });
    const bestPlan = (plans.ranked || []).filter((p) => p.valid && !p.gated).sort((a, b) => b.boxes - a.boxes)[0];
    const t = Date.now() - t0;
    const mixErr = mix ? P.validatePhysics(mix).length : -1;
    console.log(cs.name);
    console.log('   主引擎   装 ' + run.totals.loadedCount + ' 只  柜长 ' + (len(run) / 1000).toFixed(2) + 'm');
    if (bestPlan) console.log('   枚举最优 装 ' + bestPlan.boxes + ' 只  柜长 ' + (len(bestPlan.pack) / 1000).toFixed(2) + 'm');
    console.log('   分箱列块 ' + (mix ? '装 ' + mix.totals.loadedCount + ' 只  柜长 ' + (len(mix) / 1000).toFixed(2) + 'm  物理错误 ' + mixErr : '无解') + '   [' + t + 'ms]');
  });
});
