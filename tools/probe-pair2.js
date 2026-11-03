// 探针 2：哪种翻转矩阵能让两个箱体的实体互补（z=0 时重叠为 0 即互补）
const S = require('../js/core/solid.js');
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const POSES = {
  'flipX(镜像y+翻z)': [1, 0, 0, 0, -1, 0, 0, 0, -1],
  'flipY(镜像x+翻z)': [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  'flipZ(绕z转180)': [-1, 0, 0, 0, -1, 0, 0, 0, 1]
};
const shapes = {
  'L 对称 900×700 (350/350, 300/600)': {
    it: { id: 'l', shape: 'lshape', shapeValues: { l: 900, w: 700, h: 600, wlow: 350, whigh: 350, hlow: 300, hhigh: 600 }, bbox: { l: 900, w: 700, h: 600 } },
    box: { x: 0, y: 0, z: 0, l: 900, w: 700, h: 600 }
  },
  'L 不对称 900×700 (250/450, 300/600)': {
    it: { id: 'la', shape: 'lshape', shapeValues: { l: 900, w: 700, h: 600, wlow: 250, whigh: 450, hlow: 300, hhigh: 600 }, bbox: { l: 900, w: 700, h: 600 } },
    box: { x: 0, y: 0, z: 0, l: 900, w: 700, h: 600 }
  },
  '斜顶 2000×470 (500/900)': {
    it: { id: 's', shape: 'slope', shapeValues: { l: 2000, w: 470, h: 900, hlow: 500, hhigh: 900 }, bbox: { l: 2000, w: 470, h: 900 } },
    box: { x: 0, y: 0, z: 0, l: 2000, w: 470, h: 900 }
  }
};

Object.keys(shapes).forEach((name) => {
  const { it, box } = shapes[name];
  const lower = Object.assign({ skuId: it.id, pose: IDENT }, box);
  const out = [];
  Object.keys(POSES).forEach((k) => {
    const rows = [];
    for (let dz = 0; dz <= 600; dz += 100) {
      const up = Object.assign({}, box, { skuId: it.id, z: box.z + dz, pose: POSES[k] });
      rows.push(dz + ':' + Math.round(S.overlapDepth(up, lower, it, it, 10)));
    }
    out.push(k + ' [' + rows.join(' ') + ']');
  });
  console.log(name);
  out.forEach((r) => console.log('   ' + r));
});
