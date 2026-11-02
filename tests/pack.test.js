/*
 * M2 排布算法自检：
 *   node tests/pack.test.js
 *
 * 1) 硬基准：40HQ + 400×300×300 重量不设限 = 1680 箱（30×7×8），装载率 79.2%
 * 2) 随机 200 组混排：逐箱断言不越界、两两不重叠、数量与重量受控
 * 3) 装不下的必须给出原因，不许静默丢行
 */
'use strict';

const assert = require('assert');
const S = require('../js/core/shapes.js');
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failures.push({ name, error: e });
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

const EPS = 1e-6;

function row(id, values, qty, weight, shape, name) {
  return { id, shape: shape || 'rect', name: name || '', values, qty: String(qty), weight: weight === undefined ? '' : String(weight) };
}

function state(container, rows, allowFill) {
  return { container, rows, options: { allowFill: !!allowFill } };
}

function assertInBounds(pack, c, label) {
  const label2 = label || '';
  for (const p of pack.placements) {
    assert.ok(p.x >= -EPS && p.y >= -EPS && p.z >= -EPS, label2 + ' 坐标出现负数: ' + JSON.stringify(p));
    assert.ok(p.x + p.l <= c.innerL + EPS, label2 + ' 越界 x: ' + p.x + '+' + p.l + ' > ' + c.innerL);
    assert.ok(p.y + p.w <= c.innerW + EPS, label2 + ' 越界 y: ' + p.y + '+' + p.w + ' > ' + c.innerW);
    assert.ok(p.z + p.h <= c.innerH + EPS, label2 + ' 越界 z: ' + p.z + '+' + p.h + ' > ' + c.innerH);
    assert.ok(p.l > 0 && p.w > 0 && p.h > 0, label2 + ' 尺寸非正');
  }
}

function assertNoOverlap(pack, label) {
  const ps = pack.placements;
  // 对扣的一对：外接体在高度上必然交叠，但真实形状互补不重叠，单独用几何断言校验
  const isPairMate = (a, b) => a.layer === b.layer && a.x === b.x && a.y === b.y &&
    ((a.kind === 'pair-lower' && b.kind === 'pair-upper') ||
     (a.kind === 'pair-upper' && b.kind === 'pair-lower'));
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (isPairMate(ps[i], ps[j])) continue;
      if (P.overlaps(ps[i], ps[j])) {
        throw new Error((label || '') + ' 堆叠重叠: ' + JSON.stringify(ps[i]) + ' × ' + JSON.stringify(ps[j]));
      }
    }
  }
}

/** 每箱下方必须有支撑（对扣上件由下件支撑） */
function assertSupported(pack, label) {
  const byTop = {};
  pack.placements.forEach((p) => {
    const k = Math.round((p.z + p.h) * 1000);
    (byTop[k] = byTop[k] || []).push({ x: p.x, y: p.y, l: p.l, w: p.w });
  });
  const lowerKey = {};
  pack.placements.forEach((p) => {
    if (p.kind === 'pair-lower') lowerKey[p.layer + '|' + p.x + '|' + p.y] = p;
  });
  pack.placements.forEach((p) => {
    if (p.z <= 1e-6) return;
    if (p.kind === 'pair-upper') {
      const low = lowerKey[p.layer + '|' + p.x + '|' + p.y];
      if (!low) throw new Error((label || '') + ' 对扣上件找不到下件');
      return;
    }
    const rects = byTop[Math.round(p.z * 1000)];
    const ok = rects && P.covers({ x: p.x, y: p.y, l: p.l, w: p.w }, rects);
    if (!ok) throw new Error((label || '') + ' 悬空箱: ' + JSON.stringify(p));
  });
}

// ---------- 硬基准 ----------
console.log('\n硬基准（写进代码注释的那个）');

test('40HQ + 400×300×300 ×1680，重量不设限 → 正好 1680 箱', () => {
  const c = C.get('40HQ');
  const r = P.run(state(c, [row('a', { L: '400', W: '300', H: '300' }, 1680)]));
  assert.strictEqual(r.totals.loadedCount, 1680, '已装 ' + r.totals.loadedCount);
  assert.strictEqual(r.totals.remainingCount, 0);
  assert.strictEqual(r.layers.length, 8, '层数 ' + r.layers.length);
  assert.strictEqual(r.layers[0].count, 210, '首层 ' + r.layers[0].count);
  assert.strictEqual(r.layers[0].capacity, 210);
  assert.strictEqual(r.usedHeight, 2400);
  assert.ok(Math.abs(r.totals.fillRate - 0.7921) < 0.0002, '装载率 ' + r.totals.fillRate);
  assert.ok(Math.abs(r.totals.netVolume - 60.48e9) < 1, '净体积 ' + r.totals.netVolume);
});

test('400×300×300 选的是 30×7 朝向，不是 40×5', () => {
  const c = C.get('40HQ');
  const o = P.bestOrientation({ l: 400, w: 300, h: 300 }, {
    innerL: c.innerL, innerW: c.innerW, innerH: c.innerH
  });
  assert.strictEqual(o.rot, 0);
  assert.deepStrictEqual([o.nx, o.ny, o.cap], [30, 7, 210]);
});

test('1680 箱逐箱不越界', () => {
  const c = C.get('40HQ');
  const r = P.run(state(c, [row('a', { L: '400', W: '300', H: '300' }, 1680)]));
  assertInBounds(r, r.container);
});

test('每箱重 20kg：载重 26500 先撞上限，只装 1325 箱并说明原因', () => {
  const c = C.get('40HQ');
  const r = P.run(state(c, [row('a', { L: '400', W: '300', H: '300' }, 1680, 20)]));
  assert.strictEqual(r.totals.loadedCount, 1325, '已装 ' + r.totals.loadedCount);
  assert.strictEqual(r.stop.code, 'weight');
  assert.strictEqual(r.totals.remainingCount, 355);
  assert.ok(r.totals.weight <= c.payload + EPS, '超重 ' + r.totals.weight);
  assert.ok(r.totals.overloaded, '货物总重 33600 应标记超载');
  assert.ok(r.items[0].reason.message.includes('载重'));
});

// ---------- 朝向 ----------
console.log('\n朝向与层逻辑');

test('2000×600×300：旋转后每层 20 个，比不旋转的 18 个多', () => {
  const c = C.get('40HQ');
  const r = P.run(state(c, [row('a', { L: '2000', W: '600', H: '300' }, 20)]));
  assert.strictEqual(r.totals.loadedCount, 20);
  assert.strictEqual(r.layers.length, 1);
  assert.strictEqual(r.layers[0].rot, 90);
  assert.strictEqual(r.placements[0].l, 600);
  assert.strictEqual(r.placements[0].w, 2000);
  assertInBounds(r, r.container);
});

test('层高累加超内高就停：1000 高箱在 40HQ 只放得下 2 层', () => {
  const c = C.get('40HQ');
  const r = P.run(state(c, [row('a', { L: '1000', W: '1000', H: '1000' }, 100)]));
  assert.strictEqual(r.layers.length, 2);
  assert.strictEqual(r.totals.loadedCount, 48, '每层 12×2=24 个 × 2 层');
  assert.strictEqual(r.totals.remainingCount, 52);
  assert.strictEqual(r.stop.code, 'height');
  assert.ok(r.items[0].reason.message.includes('剩余高度'));
});

test('多个 SKU 按体积从大到小先后成层', () => {
  const c = C.get('40HQ');
  const r = P.run(state(c, [
    row('small', { L: '300', W: '200', H: '200' }, 40, '', 'rect', '小'),
    row('big', { L: '1200', W: '800', H: '600' }, 8, '', 'rect', '大')
  ]));
  assert.strictEqual(r.layers[0].skuId, 'big', '第一层应是体积大的');
  assert.strictEqual(r.totals.loadedCount, 48);
  assertInBounds(r, r.container);
  assertNoOverlap(r, '两 SKU');
});

// ---------- 装不进去 ----------
console.log('\n装不进去要说原因');

test('2400×2400 底面在 40HQ（内宽 2352）装不下，给出 footprint 原因', () => {
  const r = P.run(state(C.get('40HQ'), [row('a', { L: '2400', W: '2400', H: '500' }, 5)]));
  assert.strictEqual(r.items[0].loaded, 0);
  assert.strictEqual(r.items[0].remaining, 5);
  assert.strictEqual(r.items[0].reason.code, 'footprint');
  assert.ok(r.items[0].reason.message.includes('底面'));
});

test('2600 高箱超过 40HQ 门高 2585，给出 door-height 原因', () => {
  const r = P.run(state(C.get('40HQ'), [row('a', { L: '1000', W: '1000', H: '2600' }, 3)]));
  assert.strictEqual(r.items[0].loaded, 0);
  assert.strictEqual(r.items[0].reason.code, 'door-height');
  assert.ok(r.items[0].reason.message.includes('门高 2585'));
});

test('能装的和装不下的混在一起：能装的照装，装不下的单列原因', () => {
  const r = P.run(state(C.get('40HQ'), [
    row('ok', { L: '400', W: '300', H: '300' }, 10, 5),
    row('tall', { L: '500', W: '500', H: '2600' }, 2, 5)
  ]));
  assert.strictEqual(r.totals.loadedCount, 10);
  assert.strictEqual(r.totals.remainingCount, 2);
  assert.strictEqual(r.items[1].reason.code, 'door-height');
  assert.strictEqual(r.layers.length, 1);
});

// ---------- 随机 200 组 ----------
console.log('\n随机 200 组混排（不越界 / 不重叠 / 数量重量受控）');

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('200 组随机 SKU 全部满足几何与载重约束', () => {
  const rand = mulberry32(20261102);
  const shapeKeys = ['rect', 'lshape', 'slope'];
  let totalBoxes = 0;

  for (let n = 0; n < 200; n++) {
    const preset = C.presets[Math.floor(rand() * C.presets.length)];
    const container = C.get(preset.key);
    const skuCount = 1 + Math.floor(rand() * 3);
    const rows = [];

    for (let k = 0; k < skuCount; k++) {
      const shape = shapeKeys[Math.floor(rand() * shapeKeys.length)];
      const L = 100 + Math.floor(rand() * 2400);
      const W = 100 + Math.floor(rand() * 2300);
      const H = 100 + Math.floor(rand() * 2700);
      const qty = 1 + Math.floor(rand() * 80);
      const weight = rand() < 0.7 ? String(1 + Math.floor(rand() * 50)) : '';
      let values;
      if (shape === 'lshape') {
        const Wlow = Math.max(1, Math.round(W * (0.2 + rand() * 0.5)));
        const Hlow = Math.max(1, Math.round(H * 0.4));
        values = { L: String(L), W: String(W), Wlow: String(Wlow), Whigh: String(W - Wlow), Hlow: String(Hlow), Hhigh: String(H) };
      } else if (shape === 'slope') {
        const Hlow = Math.max(1, Math.round(H * 0.5));
        values = { L: String(L), W: String(W), Hlow: String(Hlow), Hhigh: String(H) };
      } else {
        values = { L: String(L), W: String(W), H: String(H) };
      }
      rows.push({ id: 'r' + k, shape, name: 'S' + k, values, qty: String(qty), weight,
        allowFlip: rand() < 0.5, allowSide: rand() < 0.5 });
    }

    const r = P.run(state(container, rows, rand() < 0.5));
    const tag = ' 第 ' + (n + 1) + ' 组（' + preset.key + '，' + skuCount + ' SKU）';

    assertInBounds(r, r.container, tag);
    assertNoOverlap(r, tag);
    assertSupported(r, tag);

    const sumLayers = r.layers.reduce((s, l) => s + l.count, 0);
    assert.strictEqual(sumLayers, r.placements.length, tag + ' 分层箱数与明细不一致');
    assert.strictEqual(r.placements.length, r.totals.loadedCount, tag + ' 已装箱数不一致');

    for (const it of r.items) {
      assert.ok(it.loaded >= 0 && it.loaded <= it.qty, tag + ' SKU 装载数越界');
      assert.strictEqual(it.loaded + it.remaining, it.qty, tag + ' 已装+剩余 ≠ 需求');
      if (it.remaining > 0) {
        assert.ok(it.reason && it.reason.message, tag + ' 有剩余却没说原因');
      }
      if (it.loaded > 0) {
        assert.ok(it.placeable, tag + ' 不可装的 SKU 却装了箱');
      }
    }

    if (r.totals.weightKnown) {
      assert.ok(r.totals.weight <= container.payload + EPS, tag + ' 超载 ' + r.totals.weight);
    }
    totalBoxes += r.totals.loadedCount;
  }

  assert.ok(totalBoxes > 1000, '随机样本太少：' + totalBoxes);
});

test('同一输入跑两次结果完全一致（可复现）', () => {
  const c = C.get('45HQ');
  const rows = [
    row('a', { L: '500', W: '400', H: '350' }, 120, 8),
    row('b', { L: '700', W: '500', H: '450' }, 60, 12, 'slope'),
    row('c', { L: '600', W: '400', Wlow: '150', Whigh: '250', Hlow: '300', Hhigh: '520' }, 30, 10, 'lshape')
  ];
  const r1 = P.run(state(c, rows));
  const r2 = P.run(state(c, rows));
  assert.strictEqual(r1.totals.loadedCount, r2.totals.loadedCount);
  assert.deepStrictEqual(r1.layers, r2.layers);
  assert.strictEqual(r1.placements.length, r2.placements.length);
  for (let i = 0; i < r1.placements.length; i++) {
    assert.deepStrictEqual(r1.placements[i], r2.placements[i]);
  }
});

test('斜顶箱按外接长方体占位（留空 = 保守），体积按净体积算', () => {
  const r = P.run(state(C.get('40HQ'), [
    row('s', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 1, 10, 'slope')
  ]));
  assert.strictEqual(r.placements[0].h, 500, '占位高度应取外接高 500');
  assert.ok(Math.abs(r.totals.netVolume - 96e6) < 1, '净体积应为 0.096 m³');
  assert.ok(r.totals.spaceUsage > r.totals.fillRate, '空间占用率应高于净装载率');
});

// ---------- v2 姿态与对扣 ----------
console.log('\nv2 姿态、对扣、填缝');

function slopeRow(qty, extra) {
  return Object.assign(row('s', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, qty, '', 'slope'), extra || {});
}

test('默认关：斜顶 500 箱、装载率 62.9%（与 v1 一致）', () => {
  const r = P.run(state(C.get('40HQ'), [slopeRow(1000)]));
  assert.strictEqual(r.totals.loadedCount, 500);
  assert.strictEqual(r.layers.length, 5);
  assert.ok(Math.abs(r.totals.fillRate - 0.629) < 0.001);
});

test('可倒放：斜顶对扣 500 → 600 箱，3 个对扣层，每层 800mm', () => {
  const r = P.run(state(C.get('40HQ'), [slopeRow(1000, { allowFlip: true })]));
  assert.strictEqual(r.totals.loadedCount, 600);
  assert.strictEqual(r.layers.length, 3);
  r.layers.forEach((L) => {
    assert.strictEqual(L.kind, 'pair');
    assert.strictEqual(L.height, 800);
    assert.strictEqual(L.count, 200, '每层 100 对 = 200 箱');
  });
  assert.strictEqual(r.usedHeight, 2400);
});

test('对扣上件确实倒放（底面朝上）且贴在下件上', () => {
  const r = P.run(state(C.get('40HQ'), [slopeRow(1000, { allowFlip: true })]));
  const lower = r.placements.filter((p) => p.kind === 'pair-lower');
  const upper = r.placements.filter((p) => p.kind === 'pair-upper');
  assert.strictEqual(lower.length, 300);
  assert.strictEqual(upper.length, 300);
  for (let i = 0; i < Math.min(20, upper.length); i++) {
    const u = upper[i];
    assert.strictEqual(u.pose[8], -1, '倒放件局部 z 轴应朝下');
    const l = lower.find((p) => p.layer === u.layer && p.x === u.x && p.y === u.y);
    assert.ok(l, '找不到对应下件');
    assert.strictEqual(u.z, l.z + 300, '上件底面应落在下件的 H低 高度');
  }
});

test('可侧放：100×100×2000 从 2760 提升到 3588（+30%）', () => {
  const defaultR = P.run(state(C.get('40HQ'), [row('t', { L: '100', W: '100', H: '2000' }, 5000)]));
  assert.strictEqual(defaultR.totals.loadedCount, 2760);
  const sideRow = row('t', { L: '100', W: '100', H: '2000' }, 5000);
  sideRow.allowSide = true;
  const sideR = P.run(state(C.get('40HQ'), [sideRow]));
  assert.strictEqual(sideR.totals.loadedCount, 3588);
  assert.ok(sideR.layers.some((L) => L.kind === 'side'));
});

test('填缝：1680 满高后还能塞进 200×200×300 小箱，且箱数只增不减', () => {
  const rows = [
    row('a', { L: '400', W: '300', H: '300' }, 1680),
    row('b', { L: '200', W: '200', H: '300' }, 300)
  ];
  const without = P.run(state(C.get('40HQ'), rows, false));
  const withFill = P.run(state(C.get('40HQ'), rows, true));
  assert.strictEqual(without.totals.loadedCount, 1680, '不填缝时小箱进不去');
  assert.strictEqual(withFill.totals.loadedCount, 1980, '填缝后 +300');
  assert.ok(withFill.totals.loadedCount >= without.totals.loadedCount, '非劣');
  assertInBounds(withFill, withFill.container);
  assertNoOverlap(withFill, '填缝');
  assertSupported(withFill, '填缝');
});

test('填缝不会挤掉更大的箱型（非劣性）', () => {
  const rows = [
    row('a', { L: '400', W: '300', H: '300' }, 600),
    row('b', { L: '200', W: '200', H: '250' }, 2000)
  ];
  const without = P.run(state(C.get('40HQ'), rows, false));
  const withFill = P.run(state(C.get('40HQ'), rows, true));
  assert.ok(withFill.totals.loadedCount >= without.totals.loadedCount,
    '填缝后反而变少：' + without.totals.loadedCount + ' → ' + withFill.totals.loadedCount);
  assertNoOverlap(withFill, '填缝非劣');
  assertSupported(withFill, '填缝非劣');
});

// ---------- 补柜估算 ----------
console.log('\n剩余货物需要几个柜');

test('2000 箱 400×300×300：本柜 1680，剩 320 还需 1 个柜', () => {
  const c = C.get('40HQ');
  const st = state(c, [row('a', { L: '400', W: '300', H: '300' }, 2000)]);
  const r = P.run(st);
  assert.strictEqual(r.totals.remainingCount, 320);
  const ex = P.extraContainers(st, r);
  assert.strictEqual(ex.count, 1);
  assert.strictEqual(ex.leftOver, 0);
  assert.strictEqual(ex.rounds.length, 1);
});

test('5000 箱：还需 2 个柜（1680 + 1640），合计 3 个', () => {
  const c = C.get('40HQ');
  const st = state(c, [row('a', { L: '400', W: '300', H: '300' }, 5000)]);
  const r = P.run(st);
  assert.strictEqual(r.totals.loadedCount, 1680);
  const ex = P.extraContainers(st, r);
  assert.strictEqual(ex.count, 2, '还需 ' + ex.count + ' 个');
  assert.deepStrictEqual(ex.rounds.map((x) => x.loaded), [1680, 1640]);
  assert.strictEqual(ex.leftOver, 0);
});

test('超门高的箱子不参与补柜，单独报告', () => {
  const c = C.get('40HQ');
  const st = state(c, [
    row('a', { L: '400', W: '300', H: '300' }, 2000, 5),
    row('t', { L: '500', W: '500', H: '2600' }, 5, 5)
  ]);
  const r = P.run(st);
  const ex = P.extraContainers(st, r);
  assert.strictEqual(ex.count, 1, '补柜数 ' + ex.count);
  assert.strictEqual(ex.impossibleCount, 5);
  assert.strictEqual(ex.impossible.length, 1);
  assert.ok(ex.impossible[0].reason.message.includes('门高'));
});

test('全部装得下时不需要补柜', () => {
  const c = C.get('40HQ');
  const st = state(c, [row('a', { L: '400', W: '300', H: '300' }, 100)]);
  const r = P.run(st);
  const ex = P.extraContainers(st, r);
  assert.strictEqual(ex.count, 0);
  assert.strictEqual(ex.leftOver, 0);
});

test('补柜计算受载重限制：大量重箱按重量分柜', () => {
  const c = C.get('40HQ');
  const st = state(c, [row('a', { L: '400', W: '300', H: '300' }, 4000, 20)]);
  const r = P.run(st);
  const ex = P.extraContainers(st, r);
  // 每柜 26500/20 = 1325 箱，4000 = 1325 × 3 + 25
  assert.strictEqual(r.totals.loadedCount, 1325);
  assert.strictEqual(ex.count, 3, '还需 ' + ex.count + ' 个柜');
  assert.strictEqual(ex.leftOver, 0);
});

console.log('\n' + passed + ' 通过，' + failures.length + ' 失败\n');
if (failures.length) process.exit(1);
