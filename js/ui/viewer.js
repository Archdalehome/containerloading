/*
 * 3D 装柜图（three.js，本地 vendor，不用 CDN）。
 *
 * 坐标：three.X = 柜长方向，three.Y = 高度，three.Z = 柜宽方向；
 *       场景里把柜子居中到原点，方便轨道相机。
 * 每种箱型一个颜色；L 形箱 / 斜顶箱按真实几何建模（不是外接长方体）。
 *
 * 对外接口（挂到 window.CL3D）：
 *   init(hostEl)      初始化渲染器，幂等
 *   build(pack)       按 pack.placements 重建场景
 *   setLayer(n)       n = 0 表示全部，否则只显示第 n 层（从 1 开始）
 *   setHighlight(id)  高亮某个 SKU，null 取消
 *   isReady()
 */
import * as THREE from '../../vendor/three.module.min.js';
import { geometryFor, edgesGeometryFor, poseMatrix3, matrix4FromR3 } from './box-geometry.js';

const PALETTE = [
  '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777',
  '#65a30d', '#0891b2', '#b45309', '#4f46e5', '#be123c'
];

const S = {
  ready: false,
  host: null,
  renderer: null,
  scene: null,
  camera: null,
  root: null,
  container: null,
  pack: null,
  meshes: [],
  lines: [],
  dunnageMeshes: [],
  emptyTip: null,
  dimLabels: {},
  cam: { theta: 0.62, phi: 1.05, radius: 10000, target: new THREE.Vector3() },
  dirty: true,
  layer: 0,
  highlight: null,
  raf: 0
};

/* ---------- 几何（已抽到 box-geometry.js，两个页面共用） ---------- */

/** 同一组（同 SKU、同层、同姿态）的箱子棱线合并进一个 LineSegments。 */
function makeEdges(item, list, edgesGeo, L, W) {
  const src = edgesGeo.attributes.position.array;
  const n = src.length;
  const positions = new Float32Array(list.length * n);
  list.forEach((p, i) => {
    const cx = p.x + p.l / 2 - L / 2;
    const cy = p.z + p.h / 2;
    const cz = p.y + p.w / 2 - W / 2;
    const base = i * n;
    for (let k = 0; k < n; k += 3) {
      positions[base + k] = src[k] + cx;
      positions[base + k + 1] = src[k + 1] + cy;
      positions[base + k + 2] = src[k + 2] + cz;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x123a63, transparent: true, opacity: 0.7 })
  );
  lines.frustumCulled = false;
  lines.userData = { skuId: item.id, layer: list[0].layer + 1, baseOpacity: 0.7, perBox: n };
  return lines;
}

/* ---------- 容器 ---------- */

function buildContainer(pack) {
  const c = pack.container;
  const L = c.innerL;
  const W = c.innerW;
  const H = c.innerH;
  const group = new THREE.Group();

  const box = new THREE.BoxGeometry(L, H, W);
  box.translate(0, H / 2, 0);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(box),
    new THREE.LineBasicMaterial({ color: 0x8fa0b5, transparent: true, opacity: 0.9 })
  );
  group.add(edges);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshLambertMaterial({ color: 0xe9eef5 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.5;
  group.add(floor);

  // 网格：每 500mm 一条，帮助判断尺度
  const grid = new THREE.GridHelper(L, Math.round(L / 500), 0xd7dee8, 0xe8edf3);
  grid.position.y = 1;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  group.add(grid);

  // 柜门一侧淡色框，标出装柜方向
  const doorMat = new THREE.MeshBasicMaterial({ color: 0xc7d4e6, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
  const doorPlane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), doorMat);
  doorPlane.rotation.y = Math.PI / 2;
  doorPlane.position.set(-L / 2, H / 2, 0);
  group.add(doorPlane);

  return group;
}

/* ---------- 相机与交互 ---------- */

function applyCamera() {
  const { theta, phi, radius, target } = S.cam;
  const sinPhi = Math.sin(phi);
  S.camera.position.set(
    target.x + radius * sinPhi * Math.cos(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * sinPhi * Math.sin(theta)
  );
  S.camera.lookAt(target);
  S.camera.updateMatrixWorld();
  S.dirty = true;
}

function frameContainer(pack) {
  const c = pack.container;
  const maxDim = Math.max(c.innerL, c.innerW, c.innerH);
  S.cam.radius = maxDim * 1.35;
  S.cam.target.set(0, c.innerH * 0.42, 0);
  S.cam.theta = 0.72;
  S.cam.phi = 1.02;
  applyCamera();
}

function bindPointer() {
  const el = S.renderer.domElement;
  let dragging = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    dragging = true;
    panning = e.button === 2 || e.shiftKey;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (panning) {
      const c = S.camera;
      const right = new THREE.Vector3().setFromMatrixColumn(c.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(c.matrix, 1);
      const k = S.cam.radius * 0.0016;
      S.cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    } else {
      S.cam.theta -= dx * 0.006;
      S.cam.phi = Math.min(1.52, Math.max(0.08, S.cam.phi - dy * 0.006));
    }
    applyCamera();
  });

  const end = (e) => {
    dragging = false;
    panning = false;
    if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.cam.radius = Math.min(60000, Math.max(800, S.cam.radius * (1 + Math.sign(e.deltaY) * 0.08)));
    applyCamera();
  }, { passive: false });
}

/* ---------- 尺寸标注（HTML 叠加层，按当前相机投影定位） ---------- */

function makeLabel(text, cls) {
  const div = document.createElement('div');
  div.className = 'dim-label ' + (cls || '');
  div.textContent = text;
  S.host.appendChild(div);
  return div;
}

function projectToHost(vec3) {
  const v = vec3.clone().project(S.camera);
  const rect = S.host.getBoundingClientRect();
  return {
    x: (v.x * 0.5 + 0.5) * rect.width,
    y: (-v.y * 0.5 + 0.5) * rect.height,
    visible: v.z < 1 && v.z > -1
  };
}

function positionLabels() {
  if (!S.container) return;
  const c = S.container;
  const L = c.innerL;
  const W = c.innerW;
  const H = c.innerH;
  const pts = {
    len: new THREE.Vector3(0, 0, W / 2 + 60),
    width: new THREE.Vector3(L / 2 + 60, 0, 0),
    height: new THREE.Vector3(-L / 2, H / 2, W / 2),
    door: new THREE.Vector3(-L / 2 - 120, 120, 0)
  };
  const rect = S.host.getBoundingClientRect();
  Object.keys(S.dimLabels).forEach((key) => {
    const el = S.dimLabels[key];
    const p = projectToHost(pts[key]);
    // 贴边时往里收一点，避免标签被画布裁掉
    const x = Math.max(44, Math.min(rect.width - 44, p.x));
    const y = Math.max(16, Math.min(rect.height - 16, p.y));
    el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%,-50%)';
    el.style.opacity = p.visible ? '1' : '0';
  });
}

/* ---------- 场景构建 ---------- */

function clearScene() {
  if (S.root) {
    S.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    S.scene.remove(S.root);
  }
  S.root = new THREE.Group();
  S.scene.add(S.root);
  S.meshes = [];
  S.lines = [];
  S.dunnageMeshes = [];
  if (S.emptyTip) { S.emptyTip.remove(); S.emptyTip = null; }
  Object.keys(S.dimLabels).forEach((k) => S.dimLabels[k].remove());
  S.dimLabels = {};
  S.layer = 0;
  S.highlight = null;
}

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

function buildInstanced(pack) {
  const c = pack.container;
  const L = c.innerL;
  const W = c.innerW;
  const byKey = new Map();

  pack.placements.forEach((p) => {
    const key = p.skuId + '|' + p.layer + '|' + (p.pose ? p.pose.join(',') : '');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  });

  const geomCache = new Map();

  byKey.forEach((list) => {
    const item = pack.items.find((it) => it.id === list[0].skuId);
    if (!item) return;

    const pose = list[0].pose || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const cacheKey = item.id + '|' + pose.join(',');
    let entry = geomCache.get(cacheKey);
    if (!entry) {
      // 箱体几何带上姿态和 4mm 视觉缝；描边直接由这份几何生成，两者不可能再分叉
      const geo = geometryFor(item);
      geo.applyMatrix4(matrix4FromR3(poseMatrix3(pose)));
      entry = { geo, edges: edgesGeometryFor(geo) };
      geomCache.set(cacheKey, entry);
    }
    const geo = entry.geo;

    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorFor(item.index)) });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    list.forEach((p, i) => {
      const cx = p.x + p.l / 2 - L / 2;
      const cy = p.z + p.h / 2;
      const cz = p.y + p.w / 2 - W / 2;
      m.makeTranslation(cx, cy, cz);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData = { skuId: item.id, layer: list[0].layer + 1, baseOpacity: 1 };
    S.root.add(mesh);
    S.meshes.push(mesh);

    // 描边合并：一箱一个 LineSegments 会有上千 draw call，这里按组只提交一个
    const lines = makeEdges(item, list, entry.edges, L, W);
    S.root.add(lines);
    S.lines.push(lines);
  });
}

/** 垫块：灰色半透明，和货品明显区分（不是货，但必须画出来，否则上面的箱子看着像悬空） */
function buildDunnage(pack) {
  const blocks = pack.dunnage || [];
  if (!blocks.length) return;
  const c = pack.container;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const byLayer = {};
  blocks.forEach((b) => {
    (byLayer[b.layer] = byLayer[b.layer] || []).push(b);
  });
  Object.keys(byLayer).forEach((k) => {
    const list = byLayer[k];
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 }),
      list.length
    );
    mesh.frustumCulled = false;
    list.forEach((b, i) => {
      pos.set(b.x + b.l / 2 - c.innerL / 2, b.z + b.h / 2, b.y + b.w / 2 - c.innerW / 2);
      scale.set(b.l, b.h, b.w);
      m4.compose(pos, q, scale);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData = { layer: list[0].layer + 1 };
    S.root.add(mesh);
    S.dunnageMeshes.push(mesh);
  });
}

function applyFilters() {
  const hi = S.highlight;

  function sync(obj) {
    const layerOk = S.layer === 0 || obj.userData.layer === S.layer;
    const hiOk = !hi || obj.userData.skuId === hi;
    obj.visible = layerOk;
    const dim = !!hi && !hiOk;
    if (obj.material) {
      obj.material.transparent = dim;
      obj.material.opacity = dim ? 0.1 : obj.userData.baseOpacity;
      obj.material.depthWrite = !dim && !(obj instanceof THREE.LineSegments);
      obj.material.needsUpdate = true;
    }
  }

  S.meshes.forEach(sync);
  S.lines.forEach(sync);
  S.dunnageMeshes.forEach(function (m) {
    m.visible = S.layer === 0 || m.userData.layer === S.layer;
  });
  S.dirty = true;
}

/* ---------- 渲染循环 ---------- */

function loop() {
  S.raf = requestAnimationFrame(loop);
  if (!S.dirty) return;
  S.dirty = false;
  S.renderer.render(S.scene, S.camera);
  positionLabels();
}

function resize() {
  if (!S.host || !S.renderer) return;
  const rect = S.host.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  S.renderer.setSize(w, h, false);
  S.camera.aspect = w / h;
  S.camera.updateProjectionMatrix();
  S.dirty = true;
}

/* ---------- 对外接口 ---------- */

function init(host) {
  if (S.ready) return true;
  if (!host) return false;
  S.host = host;

  try {
    S.renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    host.innerHTML = '<div class="viewer-error">这个浏览器无法启用 WebGL，3D 图暂时看不了。<br>换 Chrome / Edge 最新版，或打开硬件加速再试。</div>';
    return false;
  }

  S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  S.renderer.setClearColor(0xf7f9fc, 1);
  host.appendChild(S.renderer.domElement);
  S.renderer.domElement.className = 'viewer-gl';

  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color(0xf7f9fc);
  S.camera = new THREE.PerspectiveCamera(42, 1, 10, 400000);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d4e2, 1.05));
  const dir = new THREE.DirectionalLight(0xffffff, 0.75);
  dir.position.set(1, 2.2, 1.4);
  S.scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
  dir2.position.set(-1.2, 1.2, -1.6);
  S.scene.add(dir2);

  bindPointer();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize);

  S.ready = true;
  resize();
  loop();
  return true;
}

function build(pack) {
  if (!S.ready || !pack || !pack.placements) return;
  S.pack = pack;
  S.container = pack.container;
  clearScene();

  const c = pack.container;
  S.root.add(buildContainer(pack));
  buildInstanced(pack);
  buildDunnage(pack);

  // 空场景也要说一句话，别让用户对着一个空柜子猜
  if (S.meshes.length === 0) {
    const why = (pack.stop && pack.stop.message) ? pack.stop.message : '没有箱子被排进这个柜子';
    S.emptyTip = document.createElement('div');
    S.emptyTip.className = 'viewer-empty';
    S.emptyTip.innerHTML = '<b>这单没有装进任何箱子</b><br>' + why +
      '<br><span class="muted">原因和空间拆分见结果页「为什么停」</span>';
    S.host.appendChild(S.emptyTip);
  }

  S.dimLabels.len = makeLabel('内长 ' + Math.round(c.innerL) + ' mm', 'dim-l');
  S.dimLabels.width = makeLabel('内宽 ' + Math.round(c.innerW) + ' mm', 'dim-w');
  S.dimLabels.height = makeLabel('内高 ' + Math.round(c.innerH) + ' mm', 'dim-h');
  S.dimLabels.door = makeLabel('柜门', 'dim-door');

  frameContainer(pack);
  resize();
  applyFilters();
  buildLegend();
  S.dirty = true;
}

function buildLegend() {
  const wrap = document.getElementById('viewer-legend');
  if (!wrap || !S.pack) return;
  wrap.innerHTML = '';
  S.pack.items.forEach((item) => {
    if (item.loaded === 0) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'legend-item';
    chip.dataset.sku = item.id;
    chip.innerHTML = '<i style="background:' + colorFor(item.index) + '"></i><span class="legend-name">' +
      (item.name || item.shapeName + ' #' + (item.index + 1)) + '</span><span class="legend-count">' + item.loaded + ' 箱</span>';
    chip.addEventListener('click', () => {
      setHighlight(S.highlight === item.id ? null : item.id);
      Array.from(wrap.children).forEach((c) => c.classList.toggle('active', c.dataset.sku === S.highlight));
    });
    wrap.appendChild(chip);
  });

  if (S.pack.dunnage && S.pack.dunnage.length) {
    const chip = document.createElement('span');
    chip.className = 'legend-item legend-dunnage';
    chip.innerHTML = '<i style="background:#94a3b8"></i><span class="legend-name">垫块（非货品）</span>' +
      '<span class="legend-count">' + S.pack.dunnage.length + ' 块</span>';
    wrap.appendChild(chip);
  }

  const sel = document.getElementById('layer-select');
  if (sel) {
    sel.innerHTML = '<option value="0">全部 ' + S.pack.layers.length + ' 层</option>';
    S.pack.layers.forEach((L, i) => {
      const opt = document.createElement('option');
      opt.value = String(i + 1);
      opt.textContent = '第 ' + (i + 1) + ' 层（' + L.count + ' 箱 · ' + Math.round(L.height) + ' mm）';
      sel.appendChild(opt);
    });
    sel.value = '0';
  }
}

function setLayer(n) {
  S.layer = Number(n) || 0;
  applyFilters();
  positionLabels();
}

function setHighlight(id) {
  S.highlight = id || null;
  applyFilters();
}

/** 设定视角：{ theta, phi, radius }，用于预设视角与截图 */
function setView(v) {
  if (!v) return;
  if (Number.isFinite(v.theta)) S.cam.theta = v.theta;
  if (Number.isFinite(v.phi)) S.cam.phi = Math.min(1.52, Math.max(0.08, v.phi));
  if (Number.isFinite(v.radius)) S.cam.radius = Math.min(60000, Math.max(800, v.radius));
  applyCamera();
  positionLabels();
}

window.CL3D = {
  init,
  build,
  setLayer,
  setHighlight,
  setView,
  isReady: () => S.ready,
  THREE, // 测试里要用它做渲染层 AABB 断言
  _state: S
};

window.dispatchEvent(new CustomEvent('cl3d-ready'));
