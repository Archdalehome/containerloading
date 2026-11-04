/*
 * 姿态矩阵与渲染绕序的约定检查。
 *
 * 背景：对扣上件要「翻 z + 镜像剖面轴」，看着像镜像，容易让人担心几何镜像后
 * 三角形绕序变反、FrontSide 材质把箱子画成"里外翻的壳"。实测结论是：
 * 现在所有姿态（含对扣上件）行列式都是 +1，是 180° 真旋转，**不存在**绕序问题。
 * 这条测试把结论钉住：
 *   1. 三种箱型的全部姿态 + 对扣上件姿态，行列式必须为 +1
 *   2. 万一以后真引入镜像姿态，applyPose 必须能自动修绕序（用假想镜像矩阵验）
 *   3. 包围盒在两种姿态下不变（翻面不改变尺寸）
 *
 *   node tests/mirror-geometry.test.mjs
 */
import assert from 'assert';
import { geometryFor, poseMatrix3, applyPose, matrix4FromR3, det3, flipWinding } from '../js/ui/box-geometry.js';

/** 三角形绕序法线与顶点法线同向 → 正面朝外（FrontSide 能看见） */
function windingAgreement(geo) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  let agree = 0;
  let disagree = 0;
  const idx = geo.getIndex();
  const tri = (idx ? idx.count : pos.count) / 3;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const ux = pos.getX(i1) - ax, uy = pos.getY(i1) - ay, uz = pos.getZ(i1) - az;
    const vx = pos.getX(i2) - ax, vy = pos.getY(i2) - ay, vz = pos.getZ(i2) - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const dot = (nx / len) * nrm.getX(i0) + (ny / len) * nrm.getY(i0) + (nz / len) * nrm.getZ(i0);
    if (dot > 0.2) agree++;
    else if (dot < -0.2) disagree++;
  }
  return { agree, disagree };
}

const ITEMS = [
  { id: 'r1', shape: 'rect', shapeValues: { l: 900, w: 700, h: 600 }, bbox: { l: 900, w: 700, h: 600 }, allowSide: true, allowFlip: true },
  {
    id: 'l1', shape: 'lshape', allowSide: true, allowFlip: true,
    shapeValues: { l: 900, w: 700, h: 600, wlow: 350, whigh: 350, hlow: 300, hhigh: 600 },
    bbox: { l: 900, w: 700, h: 600 }
  },
  {
    id: 's1', shape: 'slope', allowSide: true, allowFlip: true,
    shapeValues: { l: 1200, w: 470, h: 900, hlow: 500, hhigh: 900 },
    bbox: { l: 1200, w: 470, h: 900 }
  }
];
// 假想的镜像姿态（当前系统里不会出现，用来验 applyPose 的兜底）
const FAKE_MIRROR = [1, 0, 0, 0, -1, 0, 0, 0, 1];

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('  ok  ' + name); }

const P = await import('../js/core/pack.js').catch(() => null);
const packMod = P && (P.default || P.pack || P);

ok('现在所有姿态（含对扣上件）都是真旋转，行列式 = +1', () => {
  assert.ok(packMod, '需要 pack.js 才能枚举姿态');
  ITEMS.forEach((it) => {
    const poses = packMod.posesFor(it);
    assert.ok(poses.length > 0, it.shape + ' 应有姿态');
    poses.forEach((p) => {
      assert.ok(Math.abs(det3(p.m) - 1) < 1e-9,
        it.shape + ' 姿态行列式应为 +1：' + JSON.stringify(p.m));
    });
    const fp = packMod.findFlipPose(it, poses[0]);
    assert.ok(fp, it.shape + ' 应有对扣上件姿态');
    assert.strictEqual(Math.round(det3(fp.m)), 1,
      it.shape + ' 对扣上件也应是真旋转（不是镜像）：' + JSON.stringify(fp.m));
    assert.strictEqual(fp.m[8], -1, it.shape + ' 对扣上件 z 轴必须是翻的');
  });
});

ok('不动姿态与对扣姿态：绕序全部朝外', () => {
  ITEMS.forEach((it) => {
    const poses = packMod.posesFor(it);
    [null, poses[0], packMod.findFlipPose(it, poses[0])].forEach((p) => {
      const geo = p ? applyPose(geometryFor(it), poseMatrix3(p.m)) : geometryFor(it);
      const r = windingAgreement(geo);
      assert.strictEqual(r.disagree, 0, it.shape + ' 有 ' + r.disagree + ' 个三角形绕序反向');
      assert.ok(r.agree > 0);
    });
  });
});

ok('万一出现镜像姿态：applyPose 自动修绕序，裸 applyMatrix4 会坏', () => {
  const geo = geometryFor(ITEMS[1]);
  geo.applyMatrix4(matrix4FromR3(poseMatrix3(FAKE_MIRROR)));
  const bare = windingAgreement(geo);
  assert.ok(bare.disagree > bare.agree, '裸镜像矩阵应当把绕序整体弄反');
  flipWinding(geo);
  assert.strictEqual(windingAgreement(geo).disagree, 0, 'flipWinding 之后应恢复');
  // 走 applyPose 的版本应当一次就对
  const fixed = applyPose(geometryFor(ITEMS[1]), poseMatrix3(FAKE_MIRROR));
  assert.strictEqual(windingAgreement(fixed).disagree, 0, 'applyPose 应自动处理镜像姿态');
});

ok('姿态变换不改变包围盒尺寸', () => {
  ITEMS.forEach((it) => {
    const base = geometryFor(it);
    base.computeBoundingBox();
    const poses = packMod.posesFor(it);
    const flipped = applyPose(geometryFor(it), poseMatrix3(packMod.findFlipPose(it, poses[0]).m));
    flipped.computeBoundingBox();
    assert.ok(Math.abs(base.boundingBox.max.y - base.boundingBox.min.y - (flipped.boundingBox.max.y - flipped.boundingBox.min.y)) < 1e-6,
      it.shape + ' 翻面后高度尺寸应不变');
  });
});

console.log('\n' + pass + ' 通过，0 失败\n');
