/*
 * 参考解（层型背包）的物理校验：把每一层的箱体按真实几何摆进柜里，
 * 再逐箱检查 ①不出界 ②实体不交叠 ③底面每一点都有同为 z 的实体顶着。
 *
 * 为什么必须做：层型背包只做尺寸/高度运算，它说「这层能叠」不代表箱子真放得上去。
 * 之前 704×482 的参考解就是 4 层竖放 L 形叠在一起——上层箱子底面有一半悬在台阶的缺口上方。
 *
 *   node tools/ref-check.js
 */
'use strict';

const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const D = require('../js/core/layerdp.js');
const SOLID = require('../js/core/solid.js');

const STEP = 20;

function buildPlacements(items, c, layers) {
  const bySku = {};
  items.forEach((it) => { bySku[it.id] = it; });
  const out = [];
  let z = 0;
  layers.forEach((t) => {
    const it = bySku[t.skuId];
    if (!it) throw new Error('参考解引用了不存在的 SKU');
    if (t.kind === 'pair') throw new Error('本工具只验普通姿态层（对扣层另走 pairFit）');
    const pose = t.pose;
    const nx = Math.floor((c.innerL + 1e-6) / pose.fx);
    const ny = Math.floor((c.innerW + 1e-6) / pose.fy);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        out.push({
          skuId: t.skuId,
          x: i * pose.fx,
          y: j * pose.fy,
          z: z,
          l: pose.fx,
          w: pose.fy,
          h: pose.thickness,
          pose: pose.m
        });
      }
    }
    z += t.thickness;
  });
  return { placements: out, height: z };
}

function check(items, c, layers) {
  const bySku = {};
  items.forEach((it) => { bySku[it.id] = it; });
  const { placements, height } = buildPlacements(items, c, layers);
  const errs = { outOfBounds: [], overlap: [], unsupported: [] };

  placements.forEach((p, idx) => {
    if (p.x < -1e-6 || p.y < -1e-6 || p.z < -1e-6 ||
        p.x + p.l > c.innerL + 1e-6 || p.y + p.w > c.innerW + 1e-6 ||
        p.z + p.h > c.innerH + 1e-6) {
      errs.outOfBounds.push({ idx, p });
    }
  });

  // 实体两两重叠（先用外接体筛，再按实体采样）
  for (let a = 0; a < placements.length; a++) {
    const A = placements[a];
    for (let b = a + 1; b < placements.length; b++) {
      const B = placements[b];
      if (A.x >= B.x + B.l - 1e-6 || B.x >= A.x + A.l - 1e-6) continue;
      if (A.y >= B.y + B.w - 1e-6 || B.y >= A.y + A.w - 1e-6) continue;
      if (A.z >= B.z + B.h - 1e-6 || B.z >= A.z + A.h - 1e-6) continue;
      const ov = SOLID.overlapDepth(A, B, bySku[A.skuId], bySku[B.skuId], STEP);
      if (ov > 1) errs.overlap.push({ a, b, ov });
    }
  }

  // 底面支撑：每个采样列，下面必须有同高的实体顶面
  placements.forEach((p, idx) => {
    const it = bySku[p.skuId];
    if (p.z <= 1e-6) return; // 落地层
    const nx = Math.max(1, Math.ceil(p.l / STEP));
    const ny = Math.max(1, Math.ceil(p.w / STEP));
    let bad = 0;
    let worstGap = 0;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const X = p.x + (i + 0.5) * p.l / nx;
        const Y = p.y + (j + 0.5) * p.w / ny;
        // 该列下方最高的实体顶面
        let top = -Infinity;
        placements.forEach((q) => {
          if (q === p || q.z + q.h > p.z + 1e-6) return;
          if (X < q.x - 1e-6 || X > q.x + q.l + 1e-6) return;
          if (Y < q.y - 1e-6 || Y > q.y + q.w + 1e-6) return;
          const sp = SOLID.spanAt(q, bySku[q.skuId], X, Y);
          if (!sp) return;
          if (sp[1] > top) top = sp[1];
        });
        const gap = p.z - top;
        if (gap > 1) {
          bad++;
          if (gap > worstGap) worstGap = gap;
        }
      }
    }
    if (bad > 0) errs.unsupported.push({ idx, z: p.z, bad, sample: nx * ny, worstGap });
  });

  return { placements: placements.length, height, errs };
}

const CASES = [
  { name: '704×482（155/327，479/616）', values: { L: '704', W: '482', Wlow: '155', Whigh: '327', Hlow: '479', Hhigh: '616' } },
  { name: '1158×802（628/174，262/363）', values: { L: '1158', W: '802', Wlow: '628', Whigh: '174', Hlow: '262', Hhigh: '363' } },
  { name: '471×702（583/119，159/302）', values: { L: '471', W: '702', Wlow: '583', Whigh: '119', Hlow: '159', Hhigh: '302' } }
];

module.exports = { check: check, buildPlacements: buildPlacements, CASES: CASES };

if (require.main === module) {
  const c = C.get('40HQ');
  let anyInvalid = false;

  CASES.forEach((cs) => {
    const row = {
      id: 'a', shape: 'lshape', name: '', values: cs.values,
      qty: '2000', weight: '', allowSide: true, allowFlip: true
    };
    const pk = P.run({ container: c, rows: [row], options: { allowFill: false, sortBy: 'volume' } });
    const ref = D.solve(pk.items, c);
    const r = check(pk.items, c, ref.layers);
    const ok = r.errs.outOfBounds.length === 0 && r.errs.overlap.length === 0 && r.errs.unsupported.length === 0;

    console.log('== ' + cs.name);
    console.log('   参考解 ' + ref.boxes + ' 箱 / 用高 ' + ref.height + '，实体 ' + r.placements + ' 只');
    console.log('   层序列: ' + ref.layers.map((t) => t.kind + '(' + t.thickness + 'mm,' + t.boxes + '箱)').join(' + '));
    console.log('   出界 ' + r.errs.outOfBounds.length + ' / 实体重叠 ' + r.errs.overlap.length + ' / 悬空 ' + r.errs.unsupported.length);
    if (r.errs.unsupported.length) {
      const u = r.errs.unsupported[0];
      console.log('   首个悬空：第 ' + u.idx + ' 只（z=' + u.z + 'mm），' + u.bad + '/' + u.sample + ' 个采样列下方无实体，最大空隙 ' + u.worstGap + 'mm');
    }
    if (r.errs.overlap.length) {
      const o = r.errs.overlap[0];
      console.log('   首个重叠：' + o.a + ' 与 ' + o.b + ' 实体重叠 ' + o.ov + 'mm');
    }
    console.log('   结论：' + (ok ? '物理合法' : '物理不合法 —— 参考解算错了，不能拿它当引擎的对照'));
    console.log('');
    if (!ok) anyInvalid = true;
  });

  process.exit(anyInvalid ? 1 : 0);
}
