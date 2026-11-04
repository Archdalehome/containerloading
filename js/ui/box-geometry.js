/*
 * 箱体几何（共享模块）
 *
 * 自动模式（js/ui/viewer.js）与手动模拟原型（manual-proto.html）都引用这一份，
 * 保证同一种箱型在两处画出来的形状、缝隙、姿态完全一致。
 * 新增箱型只改这里，不要再在别处复制一份。
 *
 * 约定：
 *   - 几何以箱体几何中心为原点，three 轴：X = 长度、Y = 高度、Z = 宽度
 *   - geometryFor 内部已经应用 4mm 视觉缝（只影响渲染，不动排布数据）
 *   - poseMatrix3 把「容器轴 3×3 姿态矩阵」共轭成 three 空间的矩阵
 */
import * as THREE from '../../vendor/three.module.min.js';

export { THREE };

export function mergeGeometries(list) {
  let total = 0;
  list.forEach((g) => { total += g.attributes.position.count; });
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let offset = 0;
  list.forEach((g) => {
    pos.set(g.attributes.position.array, offset * 3);
    norm.set(g.attributes.normal.array, offset * 3);
    offset += g.attributes.position.count;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return geo;
}

/** L 形箱：前段低（W低×H低）、后段高（W高×H高），沿长度方向不变 */
export function lshapeGeometry(sv) {
  const L = sv.l;
  const Hlow = sv.hlow;
  const Hhigh = sv.h;
  const Wlow = sv.wlow;
  const Whigh = sv.whigh;
  const W = sv.w;
  const a = new THREE.BoxGeometry(L, Hlow, Wlow).toNonIndexed();
  a.translate(0, Hlow / 2 - Hhigh / 2, -W / 2 + Wlow / 2);
  const b = new THREE.BoxGeometry(L, Hhigh, Whigh).toNonIndexed();
  b.translate(0, 0, W / 2 - Whigh / 2);
  return mergeGeometries([a, b]);
}

/** 斜顶箱：顶面沿长度方向从 H底 升到 H高 */
export function slopeGeometry(sv) {
  const shape = new THREE.Shape();
  const L = sv.l;
  const H = sv.h;
  const Hlow = sv.hlow;
  shape.moveTo(-L / 2, -H / 2);
  shape.lineTo(L / 2, -H / 2);
  shape.lineTo(L / 2, H / 2);
  shape.lineTo(-L / 2, Hlow - H / 2);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: sv.w, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -sv.w / 2);
  geo.computeVertexNormals();
  return geo;
}

/** 4mm 视觉缝的缩放系数（描边等需要同一套系数时用） */
export function gapScaleOf(sv) {
  const gap = 4;
  return {
    sx: sv.l > gap * 2 ? (sv.l - gap) / sv.l : 0.9,
    sy: sv.h > gap * 2 ? (sv.h - gap) / sv.h : 0.9,
    sz: sv.w > gap * 2 ? (sv.w - gap) / sv.w : 0.9
  };
}

/** 按箱型取真实几何（不是外接长方体），已应用 4mm 视觉缝 */
export function geometryFor(item) {
  const sv = item.shapeValues || item.bbox;
  let geo;
  if (item.shape === 'lshape') geo = lshapeGeometry(sv);
  else if (item.shape === 'slope') geo = slopeGeometry(sv);
  else geo = new THREE.BoxGeometry(sv.l, sv.h, sv.w);

  const s = gapScaleOf(sv);
  geo.scale(s.sx, s.sy, s.sz);
  return geo;
}

export const EDGE_LIFT = 1.004; // 描边轻微外扩，避免和箱体表面 z-fighting

/**
 * 棱线 = 箱体几何的 EdgesGeometry，再按包围盒中心整体外扩 EDGE_LIFT。
 * 描边和箱体共用同一份几何，不会因为「自己算模板坐标」再分叉。
 */
export function edgesGeometryFor(geo) {
  const eg = new THREE.EdgesGeometry(geo, 1);
  eg.computeBoundingBox();
  const bb = eg.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const pos = eg.attributes.position;
  for (let i = 0; i < pos.array.length; i += 3) {
    pos.array[i] = cx + (pos.array[i] - cx) * EDGE_LIFT;
    pos.array[i + 1] = cy + (pos.array[i + 1] - cy) * EDGE_LIFT;
    pos.array[i + 2] = cz + (pos.array[i + 2] - cz) * EDGE_LIFT;
  }
  pos.needsUpdate = true;
  eg.computeBoundingBox();
  return eg;
}

/** 姿态矩阵：容器轴（x长 y宽 z高）→ three 轴（X长 Y高 Z宽）的共轭变换 */
export function poseMatrix3(m) {
  var p = [0, 2, 1];
  var out = new Array(9);
  for (var i = 0; i < 3; i++) {
    for (var j = 0; j < 3; j++) out[i * 3 + j] = m[p[i] * 3 + p[j]];
  }
  return out;
}

export function matrix4FromR3(r) {
  var out = new THREE.Matrix4();
  out.set(
    r[0], r[1], r[2], 0,
    r[3], r[4], r[5], 0,
    r[6], r[7], r[8], 0,
    0, 0, 0, 1
  );
  return out;
}

/** 3×3 矩阵的行列式；姿态矩阵里出现 −1 行/列组合时就是「镜像」姿态（对扣上件） */
export function det3(r) {
  return r[0] * (r[4] * r[8] - r[5] * r[7])
    - r[1] * (r[3] * r[8] - r[5] * r[6])
    + r[2] * (r[3] * r[7] - r[4] * r[6]);
}

/**
 * 把每个三角形的顶点顺序反过来。
 * 镜像变换（行列式 < 0）会把三角形绕序翻转成顺时针，而材质默认只画正面（FrontSide）——
 * 不处理的话，对扣上件这种镜像姿态的箱子会画成"里外翻"的壳：看到的全是内壁，正面被剔除。
 * 法线不用动：镜像矩阵是正交的，法线经逆转置变换后仍然朝外，错的只有绕序。
 */
export function flipWinding(geo) {
  const idx = geo.getIndex();
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
    return geo;
  }
  ['position', 'normal', 'uv'].forEach((name) => {
    const attr = geo.getAttribute(name);
    if (!attr) return;
    const n = attr.itemSize;
    const a = attr.array;
    for (let i = 0; i + 2 < attr.count; i += 3) {
      const o1 = (i + 1) * n;
      const o2 = (i + 2) * n;
      for (let k = 0; k < n; k++) {
        const t = a[o1 + k];
        a[o1 + k] = a[o2 + k];
        a[o2 + k] = t;
      }
    }
    attr.needsUpdate = true;
  });
  return geo;
}

/**
 * 给几何套上姿态矩阵；镜像姿态顺手把绕序修正回来。
 * 三处渲染（自动页 viewer、手动页 index、原型页）都必须走这个函数，
 * 否则同一个姿态在不同页面会画得不一样。
 */
export function applyPose(geo, m3) {
  geo.applyMatrix4(matrix4FromR3(m3));
  if (det3(m3) < 0) flipWinding(geo);
  return geo;
}

