// 检查「第一排横截面装满再推进」：把每种候选布局沿柜长切片，
// 算每片的横截面填充率，统计「先掉下去又升回来」的违例（中途留半排空）。
// 用法：node tools/check-fill-order.js [组数]
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

// 固定种子的伪随机：不同次运行必须用同一批算例，否则数字不可比
let seed = Number(process.argv[3] || 12345) >>> 0;
function nextRand() {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rnd(a, b) { return a + nextRand() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function round(n) { return Math.round(n / 10) * 10; }

function fillProfile(pack, c, sx, sy) {
  const stepX = sx || 400;
  const stepY = sy || 200;
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

// 违例：某片比前一片低 15 个点以上，且后面还有比它高 10 个点以上的片
function violations(prof) {
  const bad = [];
  for (let i = 1; i < prof.length - 1; i++) {
    if (prof[i] < prof[i - 1] - 0.15) {
      const laterMax = Math.max(...prof.slice(i + 1));
      if (laterMax > prof[i] + 0.10) bad.push({ i, at: prof[i], before: prof[i - 1], later: laterMax });
    }
  }
  return bad;
}

function makeRow(i) {
  const shape = pick(['rect', 'lshape', 'slope']);
  let values;
  if (shape === 'rect') {
    values = { L: round(rnd(400, 2400)), W: round(rnd(200, 1200)), H: round(rnd(200, 1400)) };
  } else if (shape === 'lshape') {
    const wl = round(rnd(200, 700)), wh = round(rnd(200, 700));
    const hl = round(rnd(150, 700)), hh = round(hl + rnd(50, 600));
    values = { L: round(rnd(400, 2400)), Wlow: wl, Whigh: wh, Hlow: hl, Hhigh: hh };
  } else {
    const hl = round(rnd(150, 700)), hh = round(hl + rnd(50, 700));
    values = { L: round(rnd(400, 2400)), W: round(rnd(200, 1200)), Hlow: hl, Hhigh: hh };
  }
  return { id: 'r' + i, shape, name: shape + i, qty: String(Math.round(rnd(3, 40))), values, allowFlip: true, allowSide: true };
}

const N = Number(process.argv[2] || 12);
const tally = {};
const t0 = Date.now();

for (let k = 0; k < N; k++) {
  const c = C.get(pick(['20GP', '40GP', '40HQ']));
  const rows = [makeRow(0), makeRow(1)];
  const cands = [];
  const add = (tag, pk) => { if (pk && pk.placements && pk.placements.length) cands.push({ tag, pk }); };
  add('主引擎', P.run({ container: c, rows, options: {} }));
  add('切片', P.runSlices({ container: c, rows, options: {} }));
  add('混装列块', P.runColumnMix(rows, c));
  const plans = P.runPlans({ container: c, rows, options: {} });
  (plans.ranked || []).forEach((p, i) => { if (p.valid && !p.gated && p.pack) add('方案#' + i, p.pack); });

  cands.forEach(({ tag, pk }) => {
    const prof = fillProfile(pk, c);
    const bad = violations(prof);
    if (!tally[tag]) tally[tag] = { checked: 0, bad: 0, worst: 0 };
    tally[tag].checked++;
    if (bad.length) {
      tally[tag].bad++;
      tally[tag].worst = Math.max(tally[tag].worst, bad.length);
      if (bad.length >= 2) {
        console.log('违例 ' + bad.length + ' 处 [' + tag + '] 组' + k + ' ' + JSON.stringify(rows.map((r) => r.shape + '×' + r.qty)) +
          ' 首个在 x=' + (bad[0].i * 400) + 'mm：' + Math.round(bad[0].before * 100) + '% → ' + Math.round(bad[0].at * 100) + '% → 后面 ' + Math.round(bad[0].later * 100) + '%');
      }
    }
  });
}

console.log('\n汇总（中途留半排空的布局数 / 检查数）：');
Object.keys(tally).sort().forEach((k) => {
  console.log('  ' + k.padEnd(10) + tally[k].bad + ' / ' + tally[k].checked + '  最多 ' + tally[k].worst + ' 处');
});
console.log('用时 ' + (Date.now() - t0) + 'ms');
