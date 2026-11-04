// 定位：切片装柜为什么会在中途留半排空 —— 抓一个违例，把那个横截面里的箱子逐只打出来
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function round(n) { return Math.round(n / 10) * 10; }

function profile(pack, c, stepX, stepY) {
  let len = 0;
  (pack.placements || []).forEach((p) => { len = Math.max(len, p.x + p.l); });
  const out = [];
  for (let x = 0; x < len - 1e-6; x += stepX) {
    let hit = 0, total = 0;
    for (let y = 0; y < c.innerW; y += stepY) {
      for (let z = 0; z < c.innerH; z += stepY) {
        total++;
        const cx = x + stepX / 2, cy = y + stepY / 2, cz = z + stepY / 2;
        if ((pack.placements || []).some((p) =>
          cx >= p.x && cx < p.x + p.l && cy >= p.y && cy < p.y + p.w && cz >= p.z && cz < p.z + p.h)) hit++;
      }
    }
    out.push(total ? hit / total : 0);
  }
  return out;
}

function makeRow(i) {
  const shape = pick(['rect', 'lshape', 'slope']);
  let values;
  if (shape === 'rect') values = { L: round(rnd(400, 2400)), W: round(rnd(200, 1200)), H: round(rnd(200, 1400)) };
  else if (shape === 'lshape') {
    const wl = round(rnd(200, 700)), wh = round(rnd(200, 700));
    const hl = round(rnd(150, 700)), hh = round(hl + rnd(50, 600));
    values = { L: round(rnd(400, 2400)), Wlow: wl, Whigh: wh, Hlow: hl, Hhigh: hh };
  } else {
    const hl = round(rnd(150, 700)), hh = round(hl + rnd(50, 700));
    values = { L: round(rnd(400, 2400)), W: round(rnd(200, 1200)), Hlow: hl, Hhigh: hh };
  }
  return { id: 'r' + i, shape, name: shape + i, qty: String(Math.round(rnd(3, 40))), values, allowFlip: true, allowSide: true };
}

for (let k = 0; k < 400; k++) {
  const c = C.get(pick(['40GP', '40HQ']));
  const rows = [makeRow(0), makeRow(1)];
  const pk = P.runSlices({ container: c, rows, options: {} });
  if (!pk) continue;
  const prof = profile(pk, c, 200, 200);
  const max = Math.max(...prof);
  let dip = -1;
  for (let i = 1; i < prof.length - 1; i++) {
    if (prof[i] < prof[i - 1] - 0.2) {
      const later = Math.max(...prof.slice(i + 1));
      if (later > prof[i] + 0.15) { dip = i; break; }
    }
  }
  if (dip < 0) continue;
  console.log('抓到违例：' + c.key + '  ' + JSON.stringify(rows.map((r) => r.shape + ' L=' + r.values.L + ' ×' + r.qty)));
  console.log('剖面（每 200mm）：' + prof.slice(Math.max(0, dip - 6), dip + 8).map((v) => Math.round(v * 100)).join(' '));
  const x0 = (dip - 1) * 200, x1 = (dip + 2) * 200;
  console.log('x=' + x0 + '..' + x1 + ' 这一段的箱子：');
  pk.placements.filter((p) => p.x < x1 && p.x + p.l > x0).forEach((p) => {
    console.log('   sku=' + p.skuId + ' x=' + Math.round(p.x) + ' l=' + Math.round(p.l) +
      ' y=' + Math.round(p.y) + ' w=' + Math.round(p.w) + ' z=' + Math.round(p.z) + ' h=' + Math.round(p.h) + ' kind=' + p.kind);
  });
  // 每片的 top 高度，看是"层没堆满"还是"宽度没用满"
  const inX = pk.placements.filter((p) => p.x < x1 && p.x + p.l > x0);
  const maxY = Math.max(...inX.map((p) => p.y + p.w));
  const maxZ = Math.max(...inX.map((p) => p.z + p.h));
  console.log('   这一段：最远占到 y=' + Math.round(maxY) + '（柜宽 ' + c.innerW + '），最高 z=' + Math.round(maxZ) + '（柜高 ' + c.innerH + '）');
  break;
}
