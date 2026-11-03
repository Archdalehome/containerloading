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
const SOLID = require('../js/core/solid.js');

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
    ((a.kind === 'pair-lower' && (b.kind === 'pair-upper' || b.kind === 'pair-upper-l')) ||
     (a.kind === 'pair-upper' && b.kind === 'pair-lower') ||
     (a.kind === 'pair-upper-l' && b.kind === 'pair-lower'));
  // 缺口嵌合箱：落在 L 形台阶上，外接体必然被 L 箱的外接体包住，但不在其实体里
  const isNotchMate = (a, b) => a.layer === b.layer && (a.kind === 'notch' || b.kind === 'notch');
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (isPairMate(ps[i], ps[j]) || isNotchMate(ps[i], ps[j])) continue;
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

// ---------- 默认不限方向（2026-11 用户决定） ----------
console.log('\n默认不限方向：姿态按几何判定，物理约束不放松');

function poseCount(shape, values, allowSide, allowFlip) {
  const item = {
    id: 'x' + shape, shape, shapeName: shape, index: 0,
    shapeValues: { l: values.l, w: values.w, h: values.h || values.hhigh, wlow: values.wlow, whigh: values.whigh, hlow: values.hlow, hhigh: values.hhigh },
    bbox: { l: values.l, w: values.w, h: values.h || values.hhigh },
    allowSide: allowSide !== false, allowFlip: allowFlip !== false, placeable: true
  };
  return P.posesFor(item).length;
}

/** 有几种「哪个面朝下」（同一种朝下可能有两种水平旋转，这里只数面） */
function faceCount(shape, values) {
  const item = {
    id: 'xf' + shape, shape, shapeName: shape, index: 0,
    shapeValues: { l: values.l, w: values.w, h: values.h || values.hhigh, wlow: values.wlow, whigh: values.whigh, hlow: values.hlow, hhigh: values.hhigh },
    bbox: { l: values.l, w: values.w, h: values.h || values.hhigh },
    allowSide: true, allowFlip: true, placeable: true
  };
  const set = {};
  P.posesFor(item).forEach((p) => { set[p.vertical + '|' + (p.s[p.vertical] > 0 ? 1 : 0)] = 1; });
  return Object.keys(set).length;
}

test('姿态集合按几何判定：矩形 6 面、斜顶 5 面、L 形 5 面（斜面/台阶面朝下剔除）', () => {
  assert.strictEqual(faceCount('rect', { l: 600, w: 400, h: 300 }), 6, '矩形应 6 面');
  assert.strictEqual(faceCount('slope', { l: 600, w: 400, hlow: 300, hhigh: 500 }), 5, '斜顶应 5 面');
  assert.strictEqual(faceCount('lshape', { l: 600, w: 400, wlow: 160, whigh: 240, hlow: 300, hhigh: 500 }), 5, 'L 形应 5 面');
});

test('用户勾选只做减法：不勾倒放就没有顶面朝下，不勾侧放就只剩底面朝下', () => {
  const rectItem = (allowSide, allowFlip) => ({
    id: 'xt' + allowSide + allowFlip, shape: 'rect', shapeName: '矩形', index: 0,
    shapeValues: { l: 600, w: 400, h: 300 }, bbox: { l: 600, w: 400, h: 300 },
    allowSide, allowFlip, placeable: true
  });
  const noFlip = P.posesFor(rectItem(true, false));
  assert.ok(noFlip.every((p) => !(p.vertical === 2 && p.s[2] < 0)), '不勾倒放时仍有顶面朝下的姿态');
  assert.ok(noFlip.length < P.posesFor(rectItem(true, true)).length, '不勾倒放没有减少姿态');

  const noSide = P.posesFor(rectItem(false, true));
  assert.ok(noSide.every((p) => p.vertical === 2), '不勾侧放时还有侧面朝下的姿态');

  const slopeItem = {
    id: 'xs', shape: 'slope', shapeName: '斜顶', index: 0,
    shapeValues: { l: 600, w: 400, h: 500, hlow: 300, hhigh: 500 }, bbox: { l: 600, w: 400, h: 500 },
    allowSide: false, allowFlip: false, placeable: true
  };
  assert.ok(P.posesFor(slopeItem).every((p) => p.vertical === 2 && p.s[2] > 0), '斜顶限制方向后应只剩底面朝下');
});

test('默认全不限：40HQ 400×300×300 装满 1820 箱、40GP 1610 箱', () => {
  const mk = () => {
    const r = row('a', { L: '400', W: '300', H: '300' }, 5000);
    r.allowSide = true;
    r.allowFlip = true;
    return [r];
  };
  const r1 = P.runPlans(state(C.get('40HQ'), mk()));
  assert.strictEqual(r1.best.boxes, 1820, '40HQ 默认应 1820，实际 ' + r1.best.boxes);
  const r2 = P.runPlans(state(C.get('40GP'), mk()));
  assert.strictEqual(r2.best.boxes, 1610, '40GP 默认应 1610，实际 ' + r2.best.boxes);
});

test('45% 那单：40GP + L 600×400(160/240) 302 箱 → 仍装 302，垫块是关键', () => {
  const mk = () => {
    const r = row('l', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 302, '', 'lshape');
    r.allowSide = true;
    r.allowFlip = true;
    return r;
  };
  const withDun = P.runPlans({ container: C.get('40GP'), rows: [mk()], options: { allowDunnage: true } });
  assert.strictEqual(withDun.best.boxes, 302, '开垫块时应 302 全装，实际 ' + withDun.best.boxes);
  assert.ok(Math.abs(withDun.best.fillRate * 100 - 45) < 0.6, '装载率应约 45%，实际 ' + (withDun.best.fillRate * 100).toFixed(1));
  const noDun = P.runPlans({ container: C.get('40GP'), rows: [row('l', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 1000, '', 'lshape')] });
  assert.strictEqual(noDun.best.boxes, 100, '不开垫块时仍是 1 层 100 箱，实际 ' + noDun.best.boxes);
});

test('侧放的 L 形 / 斜顶：支撑面按真实接触面算，物理校验必须通过', () => {
  const slope = row('s', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 400, '', 'slope');
  slope.allowSide = true;
  slope.allowFlip = true;
  const r = P.run(state(C.get('40HQ'), [slope]));
  assert.deepStrictEqual(P.validatePhysics(r), []);
  assertInBounds(r, C.get('40HQ'), '侧放斜顶');
  assert.ok(P.posesFor(r.items[0]).some((p) => p.vertical !== 2), '斜顶的姿态集里没有侧放');

  // 直接构造一只侧放的 L（不依赖算法是否选中它），检查接触面与支撑
  const lRow = row('l', { L: '600', W: '400', Wlow: '200', Whigh: '200', Hlow: '300', Hhigh: '500' }, 1, '', 'lshape');
  lRow.allowSide = true;
  lRow.allowFlip = true;
  const base = P.run(state(C.get('40HQ'), [lRow]));
  const item = base.items[0];
  const sidePose = P.posesFor(item).filter((p) => p.vertical !== 2)[0];
  assert.ok(sidePose, 'L 形没有侧放姿态');
  const place = {
    skuId: item.id, x: 0, y: 0, z: 0,
    l: sidePose.fx, w: sidePose.fy, h: sidePose.thickness,
    layer: 0, kind: 'side', pose: sidePose.m
  };
  const pack = { items: [item], placements: [place], dunnage: [], container: C.get('40HQ') };
  assert.deepStrictEqual(P.validatePhysics(pack), [], '侧放 L 单片应能放在柜底');
  const f = P.facesRel(item, sidePose.m, place.l, place.w, place.h);
  assert.ok(f.bottom.length > 0 && f.top.length > 0, '侧放 L 的接触面算空了');
  const area = (rs) => rs.reduce((s, r) => s + r.l * r.w, 0);
  assert.ok(area(f.bottom) > 0, '侧放 L 的底面算成了 0');
});

// ---------- 用户那单（2000×470 L 形） ----------
console.log('\n用户那单：L 形 2000×470、净 0.616 m³/箱、40GP');

test('对称台阶 235/235：对扣可用，≥ 53 箱且物理校验通过（棱上采样不能误判缝隙）', () => {
  const r = row('a', { L: '2000', W: '470', Wlow: '235', Whigh: '235', Hlow: '325', Hhigh: '900' }, 200, '5', 'lshape');
  r.allowSide = true;
  r.allowFlip = true;
  const ps = P.runPlans({ container: C.get('40GP'), rows: [r], options: {} });
  assert.ok(ps.best.boxes >= 53, '对称台阶应 ≥ 53 箱，实际 ' + ps.best.boxes);
  assert.deepStrictEqual(P.validatePhysics(ps.best.pack), [], '对扣方案必须过物理校验');
});

test('不对称台阶 200/270：不垫块只能 33 箱（第二层只落在 270 条带上），垫块后 60 箱', () => {
  const mkRow = () => {
    const r = row('a', { L: '2000', W: '470', Wlow: '200', Whigh: '270', Hlow: '325', Hhigh: '900' }, 200, '5', 'lshape');
    r.allowSide = true;
    r.allowFlip = true;
    return r;
  };
  const noDun = P.runPlans({ container: C.get('40GP'), rows: [mkRow()], options: {} });
  assert.strictEqual(noDun.best.boxes, 33, '不垫块应为 33 箱，实际 ' + noDun.best.boxes);
  assert.deepStrictEqual(P.validatePhysics(noDun.best.pack), []);
  const dun = P.runPlans({ container: C.get('40GP'), rows: [mkRow()], options: { allowDunnage: true } });
  assert.strictEqual(dun.best.boxes, 60, '垫平缺口后应为 2 层 60 箱，实际 ' + dun.best.boxes);
  assert.deepStrictEqual(P.validatePhysics(dun.best.pack), []);
});

test('斜顶 2000×470（410/900）40GP：对扣 1310 + 单层 900，每列 3 箱 × 30 = 90 箱', () => {
  const r = row('a', { L: '2000', W: '470', Hlow: '410', Hhigh: '900' }, 200, '5', 'slope');
  r.allowSide = true;
  r.allowFlip = true;
  const ps = P.runPlans({ container: C.get('40GP'), rows: [r], options: {} });
  assert.strictEqual(ps.best.boxes, 90, '应为 90 箱（1 对扣 + 1 单层），实际 ' + ps.best.boxes);
  const kinds = ps.best.pack.layers.map((l) => l.kind).join(',');
  assert.strictEqual(kinds, 'pair,normal', '层姿态应为对扣 + 单层，实际 ' + kinds);
  assert.strictEqual(ps.best.pack.usedHeight, 2210, '用高应为 2210，实际 ' + ps.best.pack.usedHeight);
  assert.deepStrictEqual(P.validatePhysics(ps.best.pack), []);
  // 侧放斜顶会把上层堵死：不能被选成主姿态
  assert.ok(ps.best.pack.layers.every((l) => l.kind !== 'side'), '主方案里不该出现侧放斜顶层');
});

// ---------- 层型背包（新路径，先与引擎对平，不替换主循环） ----------
console.log('\n层型背包：与引擎对平（覆盖矩形已进背包约束）');

const DP = require('../js/core/layerdp.js');

function enginePack(key, rows, opts) {
  const ps = P.runPlans({ container: C.get(key), rows, options: opts || {} });
  return ps.best.pack;
}
function baseRow(values, qty, weight, shape) {
  const r = row('a', values, qty, weight, shape);
  r.allowSide = true;
  r.allowFlip = true;
  return r;
}

test('背包在 1820 / 1610 / 460 / 90 四组上和引擎一致', () => {
  const cases = [
    ['40HQ', baseRow({ L: '400', W: '300', H: '300' }, 5000, '8'), 1820],
    ['40GP', baseRow({ L: '400', W: '300', H: '300' }, 5000, '8'), 1610],
    ['40GP', baseRow({ L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 1000, '9', 'lshape'), 460],
    ['40GP', baseRow({ L: '2000', W: '470', Hlow: '410', Hhigh: '900' }, 200, '5', 'slope'), 90]
  ];
  cases.forEach(([key, r, want]) => {
    const pack = enginePack(key, [r], { allowDunnage: true });
    const sol = DP.solve(pack.items, pack.container);
    assert.strictEqual(sol.boxes, want, key + ' 背包应 ' + want + ' 箱，实际 ' + sol.boxes);
    assert.ok(sol.height <= pack.container.innerH + 1e-6, '背包层高超过柜内高');
  });
});

test('背包带覆盖约束：上层不能超出下层的覆盖范围（否则就是悬空）', () => {
  // 550×450 的层只盖 11×5 = 5500mm 长的格子；550×300 的层盖得更宽
  const pack = enginePack('40HQ', [baseRow({ L: '550', W: '450', H: '300' }, 3000, '8')], {});
  const sol = DP.solve(pack.items, pack.container);
  let acc = null;
  sol.layers.forEach((t) => {
    if (acc) {
      assert.ok(t.cover.l <= acc.l + 1e-6 && t.cover.w <= acc.w + 1e-6,
        '第 ' + t.boxes + ' 箱层超出下层覆盖 ' + JSON.stringify([t.cover, acc]));
    }
    acc = t.cover;
  });
});

test('背包算出的上界不会低于引擎实得（否则说明层型漏了东西，不能拿去显示）', () => {
  const r = baseRow({ L: '400', W: '300', H: '300' }, 5000, '8');
  const pack = enginePack('40HQ', [r], {});
  const bd = DP.bound(pack.items, pack.container);
  assert.ok(bd.boxes >= pack.totals.loadedCount,
    '上界 ' + bd.boxes + ' 低于实得 ' + pack.totals.loadedCount);
});

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
  assert.deepStrictEqual(P.validatePhysics(r), [], '1680 基准必须过物理校验');
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
    assert.deepStrictEqual(P.validatePhysics(r), [], tag + ' 物理校验未通过');

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

test('斜顶不开倒放：只能放一层（斜面不能承重），100 箱', () => {
  const r = P.run(state(C.get('40HQ'), [slopeRow(1000)]));
  assert.strictEqual(r.totals.loadedCount, 100, '斜顶单只上方不能再叠');
  assert.strictEqual(r.layers.length, 1);
  assert.deepStrictEqual(P.validatePhysics(r), []);
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

test('L 形台阶对称（W低=W高）时可以倒放对扣', () => {
  const rowL = row('l', { L: '600', W: '400', Wlow: '200', Whigh: '200', Hlow: '300', Hhigh: '500' }, 1000, '', 'lshape');
  rowL.allowFlip = true;
  const r = P.run(state(C.get('40HQ'), [rowL]));
  const pairs = r.placements.filter((p) => p.kind === 'pair-lower');
  assert.ok(pairs.length > 0, '对称台阶应能对扣');
  assert.ok(r.totals.loadedCount > 500, '对扣后应高于单放 500，实际 ' + r.totals.loadedCount);
  assert.deepStrictEqual(P.validatePhysics(r), []);
});

test('L 形台阶不对称（160/240）时禁止对扣，退回单放 + 缺口嵌合', () => {
  const rowL = row('l', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 1000, '', 'lshape');
  rowL.allowFlip = true;
  const r = P.run(state(C.get('40HQ'), [rowL]));
  assert.strictEqual(r.placements.filter((p) => p.kind.indexOf('pair') === 0).length, 0, '不对称 L 形出现了对扣');
  assert.ok(r.layers.every((L) => L.kind !== 'pair'));
  assert.deepStrictEqual(P.validatePhysics(r), []);
});

/* 对扣的实体几何：外接体重叠是对的，实体不许穿插。
 * 这一段是「纸箱相互侵入」那个线上问题留下的断言——只查外接体永远查不出来。 */
test('斜顶对扣：两只按真实斜面对扣后实体重叠 0、缝隙 0、顶面平到 800', () => {
  const r = P.run(state(C.get('40HQ'), [slopeRow(1000, { allowFlip: true })]));
  const item = r.items[0];
  const lower = r.placements.find((p) => p.kind === 'pair-lower');
  const upper = r.placements.find((p) => p.kind === 'pair-upper');
  assert.ok(lower && upper, '没有生成对扣件');
  const fit = SOLID.pairFit(lower, upper, item, { step: 5 });
  assert.ok(fit.overlap <= 1, '实体重叠 ' + fit.overlap.toFixed(3) + ' mm');
  assert.ok(fit.gap <= 1, '接触面缝隙 ' + fit.gap.toFixed(2) + ' mm');
  assert.ok(fit.columns > 1000, '采样列太少：' + fit.columns);
  [5, 200, 400, 595].forEach((x) => {
    const s = SOLID.spanAt(upper, item, upper.x + x, upper.y + 200);
    assert.ok(s && Math.abs(s[1] - 800) < 1, '对扣顶面不平，x=' + x + ' 顶高 ' + (s && s[1]));
    const t = SOLID.spanAt(lower, item, lower.x + x, lower.y + 200);
    assert.ok(Math.abs(s[0] - t[1]) < 1, '上件底面没贴住下件顶面，x=' + x);
  });
});

test('L 形对称台阶对扣：实体重叠 0、缝隙 0（拼成 400×800 实心块）', () => {
  const rowL = row('l', { L: '600', W: '400', Wlow: '200', Whigh: '200', Hlow: '300', Hhigh: '500' }, 1000, '', 'lshape');
  rowL.allowFlip = true;
  const r = P.run(state(C.get('40HQ'), [rowL]));
  const item = r.items[0];
  const lower = r.placements.find((p) => p.kind === 'pair-lower');
  const upper = r.placements.find((p) => p.kind === 'pair-upper-l');
  assert.ok(lower && upper, '对称台阶没有生成对扣件');
  const fit = SOLID.pairFit(lower, upper, item, { step: 5 });
  assert.ok(fit.overlap <= 1, '实体重叠 ' + fit.overlap.toFixed(3) + ' mm');
  assert.ok(fit.gap <= 1, '接触面缝隙 ' + fit.gap.toFixed(2) + ' mm');
});

test('反向用例：斜顶对扣若按「镜像宽度」翻转，实体要楔进去约 198mm，必须被 pair-overlap 抓到', () => {
  // 单独倒放有四种摆法，其中 diag(1,−1,−1) 看起来也是底朝上，但斜顶的坡沿长度方向，
  // 这种摆法上件的底面是反坡，后半段压进下件 198mm —— 这就是线上「纸箱相互侵入」的真身。
  const item = {
    id: 's', shape: 'slope', shapeName: '斜顶箱', index: 0,
    shapeValues: { l: 600, w: 400, h: 500, hlow: 300, hhigh: 500 },
    bbox: { l: 600, w: 400, h: 500 }
  };
  const pack = {
    items: [item],
    placements: [
      { skuId: 's', x: 0, y: 0, z: 0, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-lower', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { skuId: 's', x: 0, y: 0, z: 300, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-upper', pose: [1, 0, 0, 0, -1, 0, 0, 0, -1] }
    ]
  };
  const codes = P.validatePhysics(pack).map((e) => e.code);
  assert.ok(codes.indexOf('pair-overlap') >= 0, '没抓到实体穿插：' + JSON.stringify(codes));
  const fit = SOLID.pairFit(pack.placements[0], pack.placements[1], item, { step: 10 });
  assert.ok(fit.overlap > 190, '重叠量应接近 198mm，实际 ' + fit.overlap.toFixed(1));
});

test('反向用例：不对称 L 形（160/240）镜像翻转后仍然穿插，所以只能靠 pairFeasible 拦下', () => {
  const item = {
    id: 'l', shape: 'lshape', shapeName: 'L形箱', index: 1,
    shapeValues: { l: 600, w: 400, h: 500, wlow: 160, whigh: 240, hlow: 300, hhigh: 500 },
    bbox: { l: 600, w: 400, h: 500 }
  };
  const ok = P.pairFeasible(item);
  assert.strictEqual(ok, false, '不对称 L 形不该判为可对扣');
  const pack = {
    items: [item],
    placements: [
      { skuId: 'l', x: 0, y: 0, z: 0, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-lower', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { skuId: 'l', x: 0, y: 0, z: 300, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-upper-l', pose: [1, 0, 0, 0, -1, 0, 0, 0, -1] }
    ]
  };
  const codes = P.validatePhysics(pack).map((e) => e.code);
  assert.ok(codes.indexOf('pair-asymmetric-l') >= 0, '没抓到不对称 L 对扣：' + JSON.stringify(codes));
  assert.ok(codes.indexOf('pair-overlap') >= 0, '不对称 L 硬凑本应实体穿插：' + JSON.stringify(codes));
});

test('同款箱换姿态填条带：箱数只增不减，且不越界、不重叠、不悬空', () => {
  const cases = [[550, 450, 300], [610, 390, 310], [600, 400, 300], [540, 460, 320]];
  let gained = 0;
  let stripTotal = 0;
  cases.forEach((d) => {
    [true, false].forEach((side) => {
      const mkRow = () => {
        const r = row('a', { L: String(d[0]), W: String(d[1]), H: String(d[2]) }, 3000, '', 'rect');
        r.allowSide = side;
        r.allowFlip = false;
        return r;
      };
      const withStrip = P.run(state(C.get('40HQ'), [mkRow()]));
      const noStrip = P.run({ container: C.get('40HQ'), rows: [mkRow()], options: { noStripFill: true } });
      const tag = d.join('×') + (side ? ' 侧放开' : ' 侧放关');
      assert.ok(withStrip.totals.loadedCount >= noStrip.totals.loadedCount,
        tag + ' 加条带填缝后变少了：' + noStrip.totals.loadedCount + ' → ' + withStrip.totals.loadedCount);
      const strip = withStrip.layers.reduce((s, L) => s + (L.stripCount || 0), 0);
      stripTotal += strip;
      gained += withStrip.totals.loadedCount - noStrip.totals.loadedCount;
      assertInBounds(withStrip, C.get('40HQ'), tag);
      assertNoOverlap(withStrip, tag);
      assertSupported(withStrip, tag);
      assert.deepStrictEqual(P.validatePhysics(withStrip), [], tag + ' 物理校验');
      if (strip > 0) {
        const sp = withStrip.placements.filter((p) => p.kind === 'strip');
        assert.strictEqual(sp.length, strip, tag + ' 条带箱数对不上');
        sp.forEach((p) => {
          assert.ok(p.h > 0 && p.z >= 0, tag + ' 条带箱尺寸异常');
          assert.ok(p.z + p.h <= C.get('40HQ').innerH + 1e-6, tag + ' 条带箱超高');
        });
      }
    });
  });
  assert.ok(stripTotal > 0, '所有用例都没触发换姿态填条带，功能等于没接上');
  assert.ok(gained > 0, '填条带没有带来任何收益，样本选得不对');
});

test('缺口嵌合：L 形台阶上能塞进小箱，且不悬空', () => {  const rows = [
    row('l', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 200, '', 'lshape'),
    row('s', { L: '200', W: '150', H: '200' }, 2000, '', 'rect')
  ];
  const r = P.run(state(C.get('40HQ'), rows, false));
  const notch = r.placements.filter((p) => p.kind === 'notch');
  assert.ok(notch.length > 0, '缺口里没有嵌合箱');
  assert.ok(notch.every((p) => p.z > 0), '嵌合箱应落在台阶高度上');
  assert.deepStrictEqual(P.validatePhysics(r), []);
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

// ---------- 物理断言的反向用例 ----------
console.log('\n物理断言的反向用例（必须能抓出来）');

const slopeItem = {
  id: 's', shape: 'slope', shapeName: '斜顶箱', index: 0,
  shapeValues: { l: 600, w: 400, h: 500, hlow: 300, hhigh: 500 },
  bbox: { l: 600, w: 400, h: 500 }
};
const asymLItem = {
  id: 'l', shape: 'lshape', shapeName: 'L形箱', index: 1,
  shapeValues: { l: 600, w: 400, h: 500, wlow: 160, whigh: 240, hlow: 300, hhigh: 500 },
  bbox: { l: 600, w: 400, h: 500 }
};

test('斜面承重：斜顶箱顶上再放箱必须报错', () => {
  const pack = {
    items: [slopeItem],
    placements: [
      { skuId: 's', x: 0, y: 0, z: 0, l: 600, w: 400, h: 500, layer: 0, kind: 'normal', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { skuId: 's', x: 0, y: 0, z: 500, l: 600, w: 400, h: 500, layer: 1, kind: 'normal', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
    ]
  };
  const errs = P.validatePhysics(pack);
  assert.ok(errs.some((e) => e.code === 'floating' || e.code === 'slope-top-loaded'), JSON.stringify(errs.map((e) => e.code)));
});

test('单只斜顶上方压箱：单独构造一个「斜顶上方有箱」的摆法必须被 slope-top-loaded 抓到', () => {
  // 把下件标记成对扣下件时不该报；正常单只时上层有箱要报
  const pack = {
    items: [slopeItem],
    placements: [
      { skuId: 's', x: 0, y: 0, z: 0, l: 600, w: 400, h: 500, layer: 0, kind: 'normal', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { skuId: 's', x: 0, y: 0, z: 500, l: 600, w: 400, h: 500, layer: 1, kind: 'normal', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
    ]
  };
  assert.ok(P.validatePhysics(pack).some((e) => e.code === 'slope-top-loaded'));
});

test('对扣错位 2mm 必须报 pair-gap', () => {
  const pack = {
    items: [slopeItem],
    placements: [
      { skuId: 's', x: 0, y: 0, z: 0, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-lower', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { skuId: 's', x: 0, y: 0, z: 302, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-upper', pose: [-1, 0, 0, 0, 1, 0, 0, 0, -1] }
    ]
  };
  const errs = P.validatePhysics(pack);
  assert.ok(errs.some((e) => e.code === 'pair-gap'), JSON.stringify(errs.map((e) => e.code)));
});

test('不对称 L 形硬做对扣必须报 pair-asymmetric-l', () => {
  const pack = {
    items: [asymLItem],
    placements: [
      { skuId: 'l', x: 0, y: 0, z: 0, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-lower', pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { skuId: 'l', x: 0, y: 0, z: 300, l: 600, w: 400, h: 500, layer: 0, kind: 'pair-upper-l', pose: [-1, 0, 0, 0, 1, 0, 0, 0, -1] }
    ]
  };
  const errs = P.validatePhysics(pack);
  assert.ok(errs.some((e) => e.code === 'pair-asymmetric-l'), JSON.stringify(errs.map((e) => e.code)));
});

// ---------- 多方案枚举 ----------
console.log('\n多方案枚举');

test('runPlans：每个方案都过物理校验，排名按箱数 → 重心 → 净体积', () => {
  const rows = [
    row('a', { L: '400', W: '300', H: '300' }, 300),
    row('b', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 300, '', 'slope'),
    row('c', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 200, '', 'lshape')
  ];
  const ps = P.runPlans(state(C.get('40HQ'), rows, false));
  assert.strictEqual(ps.compared, 48);
  ps.plans.forEach((p) => {
    assert.deepStrictEqual(p.errors, [], '方案 #' + p.config.id + ' 物理校验未通过');
  });
  for (let i = 1; i < ps.ranked.length; i++) {
    const a = ps.ranked[i - 1];
    const b = ps.ranked[i];
    const ok = a.boxes > b.boxes ||
      (a.boxes === b.boxes && a.cog.lateral < b.cog.lateral - 1e-9) ||
      (a.boxes === b.boxes && Math.abs(a.cog.lateral - b.cog.lateral) < 1e-9 && a.net >= b.net);
    assert.ok(ok, '排名顺序不对：' + JSON.stringify([a.boxes, a.cog.lateral, b.boxes, b.cog.lateral]));
  }
});

test('1680 基准：侧放关时仍是 1680（条件断言，不是「最优必须 1680」）', () => {
  const rows = [row('a', { L: '400', W: '300', H: '300' }, 1680)];
  const ps = P.runPlans(state(C.get('40HQ'), rows, false));
  const uprightPlans = ps.plans.filter((p) => p.config.policy.key === 'upright');
  assert.ok(uprightPlans.length > 0);
  uprightPlans.forEach((p) => {
    if (p.config.order.key === 'volume') {
      assert.strictEqual(p.boxes, 1680, '侧放关、按体积排序时应为 1680');
    }
  });
  // 侧放开、货量给足时允许更多（1820），这不算回归
  const sideRows = [row('a', { L: '400', W: '300', H: '300' }, 5000)];
  const sidePs = P.runPlans(state(C.get('40HQ'), sideRows, false));
  assert.ok(sidePs.best.boxes >= 1680);
});

test('5000 箱输入：枚举完成且 ≤ 2 秒', () => {
  const rows = [
    row('a', { L: '400', W: '300', H: '300' }, 3000, '5'),
    row('b', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 1000, '6', 'slope'),
    row('c', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 1000, '7', 'lshape')
  ];
  const t0 = Date.now();
  const ps = P.runPlans(state(C.get('40HQ'), rows, false));
  const ms = Date.now() - t0;
  assert.strictEqual(ps.compared, 24, '5000 箱档位应为 24 个方案');
  assert.ok(ms <= 2000, '耗时 ' + ms + ' ms 超过 2 秒');
  console.log('      5000 箱 × ' + ps.compared + ' 方案耗时 ' + ms + ' ms');
});

test('垫块关时：需要垫块的方案不充当最优，但要标出来', () => {
  const l = [row('l', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 1000, '', 'lshape')];
  const off = P.runPlans(state(C.get('40HQ'), l, false));
  assert.strictEqual(off.best.boxes, 100, '垫块关时最优不能是垫块方案');
  assert.ok(off.bestGated && off.bestGated.boxes === 500, '应保留带前提的 500 箱方案');
  assert.ok(off.bestGated.dunnageBlocks > 0);
  const on = P.runPlans({ container: C.get('40HQ'), rows: l, options: { allowDunnage: true } });
  assert.strictEqual(on.best.boxes, 500, '打开垫块后 500 可作最优');
  assert.strictEqual(on.plans.filter((p) => p.gated).length, 0);
});

// ---------- 回归基线（任何一次改动把这些数改小，测试必须失败） ----------
console.log('\n回归基线（改小了就失败）');

const BASELINES = [
  {
    name: '40HQ 400×300×300 满柜',
    want: 1820,
    run: () => {
      const r = row('a', { L: '400', W: '300', H: '300' }, 5000);
      r.allowSide = true; r.allowFlip = true;
      return P.runPlans(state(C.get('40HQ'), [r]));
    }
  },
  {
    name: '40GP 400×300×300 满柜',
    want: 1610,
    run: () => {
      const r = row('a', { L: '400', W: '300', H: '300' }, 5000);
      r.allowSide = true; r.allowFlip = true;
      return P.runPlans(state(C.get('40GP'), [r]));
    }
  },
  {
    name: '40GP L 形 600×400(160/240) + 垫块',
    want: 460,
    run: () => {
      const r = row('l', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 1000, '', 'lshape');
      r.allowSide = true; r.allowFlip = true;
      return P.runPlans({ container: C.get('40GP'), rows: [r], options: { allowDunnage: true } });
    }
  },
  {
    name: '40HQ 550×450×300（同款换姿态填条带）',
    want: 872,
    run: () => {
      const r = row('a', { L: '550', W: '450', H: '300' }, 3000);
      r.allowSide = true; r.allowFlip = true;
      return P.runPlans(state(C.get('40HQ'), [r]));
    }
  },
  {
    name: '40HQ 610×390×310（同款换姿态填条带）',
    want: 957,
    run: () => {
      const r = row('a', { L: '610', W: '390', H: '310' }, 3000);
      r.allowSide = true; r.allowFlip = true;
      return P.runPlans(state(C.get('40HQ'), [r]));
    }
  }
];

BASELINES.forEach((b) => {
  test('基线 ' + b.name + ' ≥ ' + b.want + ' 箱', () => {
    const ps = b.run();
    assert.ok(ps.best.boxes >= b.want,
      b.name + ' 从 ' + b.want + ' 箱掉到 ' + ps.best.boxes + ' 箱（装载率 ' +
      (ps.best.fillRate * 100).toFixed(1) + '%）');
    const delta = ps.best.boxes - b.want;
    console.log('      ' + b.name + '：当前 ' + ps.best.boxes + ' 箱 / 基线 ' + b.want +
      ' 箱 / 差额 ' + (delta >= 0 ? '+' : '') + delta +
      (delta > 0 ? '  ← 比基线多 ' + delta + ' 箱，可以提基线了' : ''));
  });
});

console.log('\n' + passed + ' 通过，' + failures.length + ' 失败\n');
if (failures.length) process.exit(1);
