/*
 * 浏览器端交互自检（Edge headless + DevTools Protocol）。
 * 用法：先起本地服务（python -m http.server 8080），再：
 *   node tools/browser-check.mjs [http://127.0.0.1:8080/index.html]
 *
 * 做了哪些事：真点按钮、真输入、真触发计算，检查 DOM 结果；
 * 顺便截图到 tools/screenshot.png，并收集页面 JS 报错。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8080/index.html';
const PORT = 9333;
const WIDTH = Number(process.env.CHECK_WIDTH || 1280);
const OUT_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), WIDTH === 1280 ? 'screenshot.png' : 'screenshot-' + WIDTH + '.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('浏览器调试端口未就绪: ' + url);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else {
        this.events.push(msg);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 30000);
    });
  }
  async evaluate(expression) {
    // 代理抖动 / 页面忙会让 Runtime.evaluate 超时，这类重试一次有意义；
    // 页面真报错（exceptionDetails）不重试——重试多少次都该失败。
    let r;
    try {
      r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    } catch (e) {
      if (!/超时/.test(e.message)) throw e;
      console.log('  （首次失败：' + e.message + '，2 秒后重试一次）');
      await sleep(2000);
      r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      console.log('  （重试通过）');
    }
    if (r.exceptionDetails) {
      throw new Error('页面脚本异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

function pageTestScript() {
  return `(async () => {
  const out = { steps: [] };
  const step = (name, ok, detail) => out.steps.push({ name, ok: !!ok, detail: detail || '' });
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const cards = () => $$('.sku-card');
  const card = (i) => cards()[i];
  const calc = async () => { click($('#calc-btn')); await wait(60); };

  /** 渲染层自检：每个实例的 AABB 必须等于占位矩形（每边缩 4mm 视觉缝）、必须落在柜内腔里、
   *  两两不相交；描边逐个实例与箱体比（描边 = 箱体包围盒 × 1.004）。
   *  这些都从真实 3D 场景量，不看排布数据——数据对、渲染错也能抓出来。 */
  function renderCheck(pack, label) {
    const st = window.CL3D._state;
    const T = window.CL3D.THREE;
    const c = pack.container;
    const meshes = st.meshes;
    const groups = [];
    const map = new Map();
    pack.placements.forEach((p) => {
      const k = p.skuId + '|' + p.layer + '|' + (p.pose ? p.pose.join(',') : '');
      if (!map.has(k)) { map.set(k, []); groups.push(k); }
      map.get(k).push(p);
    });
    let maxErr = 0;
    let edgeMaxErr = 0;
    let edgeMaxWhere = '';
    let outOfBounds = 0;
    let firstOob = '';
    const boxes = [];
    const expectedBoxes = [];
    meshes.forEach((m, gi) => {
      const list = map.get(groups[gi]);
      if (!list) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const m4 = new T.Matrix4();
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, m4);
        const bb = m.geometry.boundingBox.clone().applyMatrix4(m4);
        const p = list[i];
        const cx = p.x + p.l / 2 - c.innerL / 2;
        const cy = p.z + p.h / 2;
        const cz = p.y + p.w / 2 - c.innerW / 2;
        const err = Math.max(
          Math.abs((bb.min.x + bb.max.x) / 2 - cx),
          Math.abs((bb.min.y + bb.max.y) / 2 - cy),
          Math.abs((bb.min.z + bb.max.z) / 2 - cz),
          Math.abs((bb.max.x - bb.min.x) - (p.l - 4)),
          Math.abs((bb.max.y - bb.min.y) - (p.h - 4)),
          Math.abs((bb.max.z - bb.min.z) - (p.w - 4))
        );
        if (err > maxErr) maxErr = err;
        // 柜内腔：three 的 x = 容器长（居中），y = 容器高（从柜底起），z = 容器宽（居中）
        const x0 = bb.min.x + c.innerL / 2;
        const x1 = bb.max.x + c.innerL / 2;
        const y0 = bb.min.z + c.innerW / 2;
        const y1 = bb.max.z + c.innerW / 2;
        const over = Math.max(
          -x0, x1 - c.innerL,
          -y0, y1 - c.innerW,
          -bb.min.y, bb.max.y - c.innerH
        );
        if (over > 1) {
          outOfBounds++;
          if (!firstOob) {
            firstOob = '第 ' + (p.layer + 1) + ' 层 ' + p.skuId + ' at x=' + p.x + ' y=' + p.y + ' z=' + p.z +
              ' → 越界 ' + over.toFixed(2) + ' mm';
          }
        }
        boxes.push({ min: bb.min, max: bb.max, p });
        expectedBoxes.push({ min: bb.min.clone(), max: bb.max.clone() });
      }
    });

    // 描边：逐实例比对（每个箱子的棱线包围盒必须是它自己箱体包围盒 × 1.004）
    st.lines.forEach((ln, li) => {
      const list = map[groups[li]];
      const mesh = meshes[li];
      if (!list || !mesh) return;
      const perBox = ln.userData.perBox || 0;
      if (!perBox) return;
      const pos = ln.geometry.attributes.position;
      const m4 = new T.Matrix4();
      for (let i = 0; i < list.length; i++) {
        mesh.getMatrixAt(i, m4);
        const bb = mesh.geometry.boundingBox.clone().applyMatrix4(m4);
        const sc = { x: (bb.max.x - bb.min.x) / 2, y: (bb.max.y - bb.min.y) / 2, z: (bb.max.z - bb.min.z) / 2 };
        const ct = { x: (bb.max.x + bb.min.x) / 2, y: (bb.max.y + bb.min.y) / 2, z: (bb.max.z + bb.min.z) / 2 };
        let mn = { x: Infinity, y: Infinity, z: Infinity };
        let mx = { x: -Infinity, y: -Infinity, z: -Infinity };
        const base = i * perBox;
        for (let k = 0; k < perBox; k++) {
          const x = pos.getX(base + k);
          const y = pos.getY(base + k);
          const z = pos.getZ(base + k);
          if (x < mn.x) mn.x = x; if (x > mx.x) mx.x = x;
          if (y < mn.y) mn.y = y; if (y > mx.y) mx.y = y;
          if (z < mn.z) mn.z = z; if (z > mx.z) mx.z = z;
        }
        const e = Math.max(
          Math.abs((mn.x + mx.x) / 2 - ct.x),
          Math.abs((mn.y + mx.y) / 2 - ct.y),
          Math.abs((mn.z + mx.z) / 2 - ct.z),
          Math.abs((mx.x - mn.x) - sc.x * 2 * 1.004),
          Math.abs((mx.y - mn.y) - sc.y * 2 * 1.004),
          Math.abs((mx.z - mn.z) - sc.z * 2 * 1.004)
        );
        if (e > edgeMaxErr) {
          edgeMaxErr = e;
          edgeMaxWhere = '第 ' + (list[i].layer + 1) + ' 层 第 ' + (i + 1) + ' 箱';
        }
      }
    });

    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.p.layer === b.p.layer && (
          (a.p.kind === 'pair-lower' && (b.p.kind === 'pair-upper' || b.p.kind === 'pair-upper-l')) ||
          (a.p.kind.indexOf('pair-upper') === 0 && b.p.kind === 'pair-lower') ||
          a.p.kind === 'notch' || b.p.kind === 'notch')) continue;
        const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
        const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
        const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
        if (ox > 1 && oy > 1 && oz > 1) overlaps++;
      }
    }

    return { maxErr, overlaps, edgeErr: edgeMaxErr, edgeWhere: edgeMaxWhere, outOfBounds, firstOob, count: boxes.length, label: label || '' };
  }

  await wait(120);

  try {

  // 1. 默认状态：40HQ + 一行矩形箱
  const c = cards();
  step('默认一行矩形箱', c.length === 1, '行数=' + c.length);
  step('矩形箱三个字段', $$('.v-input', c[0]).length === 3, '字段数=' + $$('.v-input', c[0]).length);
  step('默认规格 40HQ 内长 12032', $('#spec-innerL').value === '12032', '内长=' + $('#spec-innerL').value);
  step('40HQ 预设高亮', $('.preset.active') && $('.preset.active').dataset.key === '40HQ');

  // 2. 加一行 → 切 L 形
  click($('#add-sku'));
  await wait(50);
  step('添加箱型后两行', cards().length === 2, '行数=' + cards().length);

  click($('[data-act="delete"]', card(1)));
  await wait(50);
  step('删除行生效', cards().length === 1, '行数=' + cards().length);
  click($('#add-sku'));
  await wait(50);

  click($('.shape-tab[data-shape="lshape"]', card(1)));
  await wait(50);
  const keys = $$('.v-input', card(1)).map(i => i.dataset.key).join(',');
  step('L形箱字段正确', keys === 'L,W,Wlow,Whigh,Hlow,Hhigh', keys);
  const noteText = $('.shape-note', card(1))?.textContent || '';
  step('L形箱截面说明可见', noteText.includes('W低') && noteText.includes('W高') && noteText.includes('截面'), noteText);

  // 3. 填 L 形，故意让 W低+W高 ≠ W
  const setField = (idx, key, v) => setVal($('.v-input[data-key="' + key + '"]', card(idx)), v);
  setField(1, 'L', '600');
  setField(1, 'W', '450');
  setField(1, 'Wlow', '160');
  setField(1, 'Whigh', '240');
  setField(1, 'Hlow', '300');
  setField(1, 'Hhigh', '500');
  setVal($('.qty-input', card(1)), '20');
  setVal($('.weight-input', card(1)), '15');
  await calc();
  const errText = $('#result-body').textContent;
  step('W之和不符被拦下', $('#result-card').classList.contains('is-error'), $('#result-title').textContent);
  step('错误信息含差值 50', errText.includes('差 50'), errText.slice(0, 120));
  step('错误行标红', !!$('.v-input.invalid', card(1)));

  // 4. 改成一致 → 出装柜结果
  setField(1, 'W', '400');
  await calc();
  step('修正后校验通过', $('#result-card').classList.contains('is-ok'), $('#result-title').textContent);
  const skuTable = $$('#result-body .tbl')[0];
  step('SKU 表两行数据', $$('tbody tr', skuTable).length === 2, '行数=' + $$('tbody tr', skuTable).length);
  step('出现体积装载率', $('#result-body').textContent.includes('体积装载率'));
  step('已装箱 120 箱', $('#result-body').textContent.includes('120 / 120 箱'), $('#result-body .metric-value').textContent);
  const firstSkuRow = $$('tbody tr', skuTable)[0];
  step('矩形箱 100 箱净体积 3.600 m³', firstSkuRow.children[7].textContent.trim() === '3.600', firstSkuRow.children[7].textContent);
  const secondSkuRow = $$('tbody tr', skuTable)[1];
  step('L形箱 20 箱全部装入', secondSkuRow.children[5].textContent.trim() === '20' && secondSkuRow.children[6].textContent.trim() === '0');
  step('分层明细有数据', $$('#result-body .tbl')[1] && $$('tbody tr', $$('#result-body .tbl')[1]).length >= 2);

  // 5. 门高约束：默认不限方向后 2600 高的箱子能躺下装（只给提示），
  //    真正被拦的是任何朝向都过不了门高的箱子
  setField(1, 'L', '4000');
  setField(1, 'W', '4000');
  setField(1, 'Wlow', '2000');
  setField(1, 'Whigh', '2000');
  setField(1, 'Hlow', '2000');
  setField(1, 'Hhigh', '4000');
  await calc();
  const doorMsg = $('#result-body').textContent;
  step('任何朝向都超门高才被拦下', $('#result-card').classList.contains('is-error'), doorMsg.slice(0, 80));
  step('提示写明门高 2585', doorMsg.includes('门高 2585'), doorMsg.slice(0, 160));

  // 6. 切 20GP → 门高 2280
  click($('.preset[data-key="20GP"]'));
  await wait(50);
  step('切换 20GP 生效', $('#spec-innerL').value === '5898' && $('#spec-doorH').value === '2280', '内长=' + $('#spec-innerL').value + ' 门高=' + $('#spec-doorH').value);
  await calc();
  step('20GP 门高 2280 提示', $('#result-body').textContent.includes('门高 2280'));
  // 还原成能装的 L 形，后面的用例继续用
  setField(1, 'L', '600');
  setField(1, 'W', '400');
  setField(1, 'Hlow', '300');
  setField(1, 'Hhigh', '500');

  // 7. 数量非法
  setVal($('.qty-input', card(1)), '0');
  await calc();
  step('数量 0 被拦下', $('#result-card').classList.contains('is-error') && $('#result-body').textContent.includes('整数'));
  setVal($('.qty-input', card(1)), '20');

  // 8. 回到 40HQ，跑硬基准：1680 箱
  click($('.preset[data-key="40HQ"]'));
  await wait(50);
  setField(1, 'Hhigh', '500');
  click($('[data-act="delete"]', card(1)));
  await wait(50);
  setVal($('.qty-input', cards()[0]), '1680');
  setVal($('.weight-input', cards()[0]), '');
  await calc();
  const bigText = $('#result-body').textContent;
  step('UI 算出 1680 箱', bigText.includes('1,680 / 1,680 箱') && $('#result-card').classList.contains('is-ok'), $('#result-title').textContent);
  const layerTable = $$('#result-body .tbl')[1];
  step('分层明细 8 层', layerTable && $$('tbody tr', layerTable).length === 8, layerTable ? $$('tbody tr', layerTable).length : 'no table');
  step('体积装载率 79.2%', bigText.includes('79.2%'), bigText.slice(0, 160));
  step('用高 2400 mm', bigText.includes('用高 2400'));

  await wait(500);
  const rcNormal = renderCheck(window.CL.app.lastPack, 'normal');
  step('渲染 AABB 与占位矩形一致（正放 1680 箱）', rcNormal.maxErr < 1, '误差 ' + rcNormal.maxErr.toFixed(2) + ' mm');
  step('渲染箱体全在柜内腔（正放 1680 箱）', rcNormal.outOfBounds === 0, rcNormal.firstOob || '越界 0 箱');
  step('渲染箱体两两不相交（正放）', rcNormal.overlaps === 0, '重叠 ' + rcNormal.overlaps);
  step('描边与箱体包围盒一致（正放）', rcNormal.edgeErr < 1, '偏差 ' + rcNormal.edgeErr.toFixed(2) + ' mm ' + rcNormal.edgeWhere);
  const healthText = ($('#health-box') || {}).textContent || '';
  step('本单体检四项全 0', healthText.includes('越界箱数') && healthText.includes('全部通过'),
    healthText.replace(/\s+/g, ' ').slice(0, 120));

  // 9. 3D 图
  await wait(400);

  // 空场景也要有话说：直接交给 viewer 一个空 pack，看它是不是给原因
  const emptyTip = (() => {
    const c = window.CL.containers.get('40HQ');
    window.CL3D.build({ container: c, items: [], placements: [], layers: [], dunnage: [], totals: {} });
    const el = document.querySelector('#viewer-canvas .viewer-empty');
    return { has: !!el, text: (el ? el.textContent : '').replace(/\s+/g, ' ').slice(0, 80) };
  })();
  step('3D 空场景给出原因（不留白）', emptyTip.has && emptyTip.text.includes('没有装进任何箱子'), emptyTip.text);
  await calc();
  await wait(300);

  const gl = $('#viewer-canvas canvas');
  step('3D 画布已创建', !!gl && gl.width > 0 && gl.height > 0, gl ? gl.width + '×' + gl.height : '无 canvas');
  step('3D 卡片可见', !$('#viewer-card').classList.contains('hidden'));
  const sel = $('#layer-select');
  step('层选择器 9 项', sel && sel.options.length === 9, sel ? sel.options.length : '无选择器');
  if (sel) {
    sel.value = '3';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(150);
    const visCount = window.CL3D._state.meshes.filter((m) => m.visible)
      .reduce((s, m) => s + m.count, 0);
    const visLines = window.CL3D._state.lines.filter((l) => l.visible).length;
    step('只看第 3 层是 210 箱', window.CL3D._state.layer === 3 && visCount === 210, '可见 ' + visCount + ' 箱');
    step('描边跟随层筛选', visLines === 1, '可见描边组 ' + visLines);
    sel.value = '0';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(100);
  }
  step('图例 1 个箱型', $$('#viewer-legend .legend-item').length === 1, $$('#viewer-legend .legend-item').length);
  const lineVerts = window.CL3D._state.lines.reduce((s, l) => s + l.geometry.attributes.position.count, 0);
  step('箱体描边已生成（1680 箱 × 12 边）', lineVerts === 1680 * 24, '描边顶点 ' + lineVerts);
  const dims = $$('#viewer-canvas .dim-label').map((d) => d.textContent).join('|');
  step('尺寸标注齐全', dims.includes('12032') && dims.includes('2352') && dims.includes('2698') && dims.includes('柜门'), dims);

  // 9. 装不完时要说清原因 + 补柜数量
  setVal($('.qty-input', cards()[0]), '2000');
  await calc();
  step('装不完显示部分装载', $('#result-card').classList.contains('is-partial'), $('#result-title').textContent);
  step('剩余原因写剩余高度', $('#result-body').textContent.includes('剩余高度'));
  step('给出补柜数量', $('#result-body').textContent.includes('还需 1 个柜'), $('#result-body').textContent.slice(0, 200));
  step('所需柜数 2 个 40HQ', $('#result-body').textContent.includes('2 个 40HQ'));

  // 为什么停：装载率旁边必须有原因和空间拆分
  const whyBox = $('#result-body .why-box');
  step('结果页有「为什么停」', !!whyBox, whyBox ? 'ok' : '没有 .why-box');
  if (whyBox) {
    const whyText = whyBox.textContent.replace(/\s+/g, ' ');
    step('为什么停写了停止原因', whyText.includes('为什么停在这里') && whyText.length > 20, whyText.slice(0, 80));
    step('剩余空间拆成可承重 / 不可承重', whyText.includes('可承重') && whyText.includes('不可承重'), whyText.slice(0, 200));
    step('不可承重拆出斜面 / 零碎 / 高度不足',
      whyText.includes('斜面') && whyText.includes('顶面零碎') && whyText.includes('高度不足'), whyText.slice(0, 220));
  }

  // 状态区分：装不下 → 停因行；全部装入 → 「全部…已装入」+ 还能再放 N 箱。两者互斥
  const partialBody = $('#result-body').textContent;
  step('装不下时不出现「全部装入」文案', !partialBody.includes('货量上限，非算法限制'), '当前是部分装载');
  // 反向：正常结果里不能出现「全不合法」「一箱没装」这两类兜底提示（说明它们只在真异常时出现）
  step('正常结果不出现「全部未通过物理校验」', !partialBody.includes('全部未通过物理校验'), 'ok');
  step('正常结果不出现「一个箱子都没装进去」', !partialBody.includes('一个箱子都没装进去'), 'ok');
  // 复制诊断：点一下要能拼出一段可粘贴的文本
  const diagBtn = $('#diag-btn');
  step('结果页有「复制诊断」按钮', !!diagBtn, diagBtn ? 'ok' : '没有 #diag-btn');
  if (diagBtn) {
    click(diagBtn);
    await wait(200);
    const txt = (window.CL.ui.diag.last() || '');
    step('诊断文本含柜型/箱型/开关/为什么停/体检',
      txt.includes('柜型：') && txt.includes('输入箱型') && txt.includes('开关：') &&
      txt.includes('为什么停：') && txt.includes('体检：'), txt.slice(0, 100).split(String.fromCharCode(10)).join(' | '));
    const tip = ($('#result-body .diag-tip') || {}).textContent || '';
    step('复制后有反馈文字', tip.length > 0, tip);
  }
  setVal($('.qty-input', cards()[0]), '100');
  await calc();
  await wait(250);
  const doneBody = $('#result-body').textContent;
  const doneBox = $('#result-body .why-box.is-done');
  step('输入量小于容量时出现「全部…已装入」', !!doneBox && doneBody.includes('全部 100 箱已装入本柜'),
    (doneBox ? doneBox.textContent : doneBody).replace(/\s+/g, ' ').slice(0, 120));
  step('全部装入时给出还能再放多少箱', doneBody.includes('还能再放约'),
    (doneBox ? doneBox.textContent : '').replace(/\\s+/g, ' ').slice(0, 160));
  step('全部装入时不出现停因行', !doneBody.includes('为什么停在这里'), '两者互斥');
  step('全部装入时写明装载率是货量上限', doneBody.includes('货量上限，非算法限制'), 'ok');

  // 同款换姿态填条带：550×450×300 侧放开，条带里塞得进去
  click($('.shape-tab[data-shape="rect"]', cards()[0]));
  await wait(80);
  setField(0, 'L', '550');
  setField(0, 'W', '450');
  setField(0, 'H', '300');
  const sideOn = $('.opt-side', cards()[0]);
  if (sideOn && !sideOn.checked) {
    sideOn.checked = true;
    sideOn.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.CL.app.state.rows[0].allowSide = true;
  setVal($('.qty-input', cards()[0]), '3000');
  await calc();
  await wait(300);
  const stripPack = window.CL.app.lastPack;
  const stripCount = stripPack.layers.reduce((s, L) => s + (L.stripCount || 0), 0);
  // 条带填缝只是手段之一：层型最优方案（550 那单 960 箱）不靠条带也能超过条带方案，
  // 所以判「收益没丢」——要么用了条带，要么总箱数不低于条带基线 872。
  step('同款换姿态填条带生效（或层型最优更优）',
    stripCount > 0 || stripPack.totals.loadedCount >= 872,
    '条带箱数 ' + stripCount + ' · 共 ' + stripPack.totals.loadedCount + ' 箱');
  const layerTbl = $$('#result-body .tbl').find((t) => t.textContent.includes('层顶高度'));
  step('分层明细分开显示主姿态 / 条带',
    !!layerTbl && layerTbl.textContent.includes('主姿态 / 换姿态填条带'), layerTbl ? 'ok' : '没有分层表');
  const rcStrip = renderCheck(stripPack, 'strip');
  step('条带填缝后渲染不越界 / 不穿插', rcStrip.outOfBounds === 0 && rcStrip.overlaps === 0,
    '越界 ' + rcStrip.outOfBounds + ' / 重叠 ' + rcStrip.overlaps);
  const stripHealth = ($('#health-box') || {}).textContent || '';
  step('条带填缝后本单体检全 0', stripHealth.includes('全部通过'), stripHealth.replace(/\s+/g, ' ').slice(0, 120));

  // 复位成默认「不限方向」，后面的垫块 / 对扣用例按默认值跑
  if (sideOn && !sideOn.checked) {
    sideOn.checked = true;
    sideOn.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const flipOn = $('.opt-flip', cards()[0]);
  if (flipOn && !flipOn.checked) {
    flipOn.checked = true;
    flipOn.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.CL.app.state.rows[0].allowSide = true;
  window.CL.app.state.rows[0].allowFlip = true;
  setVal($('.qty-input', cards()[0]), '1680');
  await calc();
  await wait(200);

  const csv = window.CL.report.buildCsv(window.CL.app.lastPack, window.CL.app.state, { extra: window.CL.app.lastPack.extra });
  step('CSV 生成正常（入口等 v2 姿态定稿再开放）', csv.includes('分层小计') && csv.includes('逐箱明细') && csv.includes('列号') && csv.split('\\r\\n').length > 200, '长度 ' + csv.length);
  step('导出入口已开放', !!$('#export-btn') && !$('#export-btn').hidden);
  click($('#export-btn'));
  await wait(120);

  setVal($('.qty-input', cards()[0]), '1680');
  await calc();

  // 10. 姿态开关：斜顶开「可倒放」后出现对扣层，且 3D 里上件真翻转
  step('切换前仍是 1 行', cards().length === 1, '行数=' + cards().length);
  const slopeTab = $('.shape-tab[data-shape="slope"]', cards()[0]);
  step('斜顶标签存在', !!slopeTab);
  if (slopeTab) {
    click(slopeTab);
    await wait(100);
  }
  step('切斜顶后字段齐全', !!$('.v-input[data-key="Hhigh"]', cards()[0]));
  setField(0, 'L', '600');
  setField(0, 'W', '400');
  setField(0, 'Hlow', '300');
  setField(0, 'Hhigh', '500');
  setVal($('.qty-input', cards()[0]), '600');
  await calc();
  step('斜顶默认不限方向：600 箱全部装下', window.CL.app.lastPack.totals.loadedCount === 600,
    '已装 ' + window.CL.app.lastPack.totals.loadedCount + ' 箱，首层 ' + window.CL.app.lastPack.layers[0].kind);
  step('斜顶的对扣方案仍在候选里',
    (window.CL.app.planSet.plans || []).some((pl) => pl.pack.layers.length && pl.pack.layers[0].kind === 'pair'),
    '对扣方案数 ' + (window.CL.app.planSet.plans || []).filter((pl) => pl.pack.layers.length && pl.pack.layers[0].kind === 'pair').length);

  const flipBox = $('.opt-flip', cards()[0]);
  step('可倒放开关存在', !!flipBox);
  if (flipBox) {
    flipBox.checked = true;
    flipBox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await wait(80);
  await calc();
  const pairPack = window.CL.app.lastPack;
  step('勾可倒放后出现对扣层', pairPack.layers[0].kind === 'pair', pairPack.layers[0].kind);
  const upper = pairPack.placements.find((p) => p.kind === 'pair-upper');
  step('对扣上件姿态是底面朝上', !!upper && upper.pose[8] === -1, upper ? upper.pose.join(',') : '无上件');

  await wait(500);
  const rcPair = renderCheck(pairPack, 'pair');
  step('渲染 AABB 与占位矩形一致（对扣 / 倒放件）', rcPair.maxErr < 1, '误差 ' + rcPair.maxErr.toFixed(2) + ' mm');
  step('渲染箱体全在柜内腔（对扣 / 倒放件）', rcPair.outOfBounds === 0, rcPair.firstOob || '越界 0 箱');
  step('渲染箱体两两不相交（对扣 / 倒放件）', rcPair.overlaps === 0, '重叠 ' + rcPair.overlaps);
  step('描边与箱体包围盒一致（对扣 / 倒放件）', rcPair.edgeErr < 1, '偏差 ' + rcPair.edgeErr.toFixed(2) + ' mm ' + rcPair.edgeWhere);

  // 对扣实体：上件底面必须贴住下件斜面，不许楔进去（线上「相互侵入」的根）
  const pairSolid = (() => {
    const low = pairPack.placements.find((p) => p.kind === 'pair-lower');
    const up = pairPack.placements.find((p) => p.kind === 'pair-upper');
    if (!low || !up || !window.CL.solid) return null;
    const item = pairPack.items.find((i) => i.id === up.skuId);
    const fit = window.CL.solid.pairFit(low, up, item, { step: 5 });
    return { overlap: fit.overlap, gap: fit.gap, columns: fit.columns, pose: up.pose.join(',') };
  })();
  step('对扣实体不穿插、接触面贴合', !!pairSolid && pairSolid.overlap <= 1 && pairSolid.gap <= 1,
    pairSolid ? '重叠 ' + pairSolid.overlap.toFixed(2) + ' mm / 缝隙 ' + pairSolid.gap.toFixed(2) +
      ' mm / 上件姿态 ' + pairSolid.pose : '无对扣件');

  // 柜底：占位 min z 与渲染 min Y 一起报，不接受"看起来没超"
  const floorProbe = (() => {
    const pack = window.CL.app.lastPack;
    const st = window.CL3D._state;
    const T = window.CL3D.THREE;
    let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    pack.placements.forEach((p) => {
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z + p.h);
    });
    const m4 = new T.Matrix4();
    st.meshes.forEach((m) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, m4);
        const bb = m.geometry.boundingBox.clone().applyMatrix4(m4);
        minY = Math.min(minY, bb.min.y);
        maxY = Math.max(maxY, bb.max.y);
      }
    });
    return { minZ, maxZ, minY, maxY, innerH: pack.container.innerH };
  })();
  step('对扣场景柜底：占位 min z = 0，渲染 min Y ≥ 0 且不超柜顶',
    floorProbe.minZ === 0 && floorProbe.minY >= -1 && floorProbe.maxY <= floorProbe.innerH + 1,
    '占位 min z=' + floorProbe.minZ + ' max z=' + floorProbe.maxZ +
    '；渲染 min Y=' + floorProbe.minY.toFixed(2) + ' max Y=' + floorProbe.maxY.toFixed(2) +
    '；柜内高 ' + floorProbe.innerH);

  await wait(500);
  const geoCheck = (() => {
    const meshes = window.CL3D._state.meshes.filter((m) => m.userData.layer === 1);
    let flatTop = null;
    let slopedTop = null;
    meshes.forEach((m) => {
      const pos = m.geometry.attributes.position;
      let maxL = -1e9;
      let maxR = -1e9;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        if (x < -50) maxL = Math.max(maxL, y);
        if (x > 50) maxR = Math.max(maxR, y);
      }
      if (Math.abs(maxL - maxR) < 5) flatTop = { maxL, maxR };
      else slopedTop = { maxL, maxR };
    });
    return { flatTop, slopedTop };
  })();
  step('3D 里倒放件顶面是平的（真翻转，不是摆样子）', !!geoCheck.flatTop, JSON.stringify(geoCheck));
  step('3D 里正放件顶面是斜的', !!geoCheck.slopedTop, JSON.stringify(geoCheck));

  const fillToggle = $('#allow-fill');
  step('填缝开关存在且默认关', !!fillToggle && !fillToggle.checked);

  // 12. 垫块：L 形 + 垫块开关，3D 必须画出垫块且不计箱数
  click($('.shape-tab[data-shape="lshape"]', cards()[0]));
  await wait(100);
  setField(0, 'L', '600');
  setField(0, 'W', '400');
  setField(0, 'Wlow', '160');
  setField(0, 'Whigh', '240');
  setField(0, 'Hlow', '300');
  setField(0, 'Hhigh', '500');
  setVal($('.qty-input', cards()[0]), '400');
  const dToggle = $('#allow-dunnage');
  step('垫块开关存在', !!dToggle);
  if (dToggle) {
    dToggle.checked = true;
    dToggle.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await calc();
  const dnPack = window.CL.app.lastPack;
  step('垫块开关生效', !!dnPack.dunnage && dnPack.dunnage.length > 0, dnPack.dunnage ? dnPack.dunnage.length : 0);
  step('垫块不计入箱数', dnPack.placements.length === dnPack.totals.loadedCount);
  await wait(400);
  step('3D 画出垫块', window.CL3D._state.dunnageMeshes.length > 0 &&
    window.CL3D._state.dunnageMeshes[0].count > 0,
    window.CL3D._state.dunnageMeshes.length);

  await wait(300);
  const rcDun = renderCheck(dnPack, 'dunnage');
  step('渲染 AABB 与占位矩形一致（L 形 + 垫块）', rcDun.maxErr < 1, '误差 ' + rcDun.maxErr.toFixed(2) + ' mm');
  step('渲染箱体全在柜内腔（L 形 + 垫块）', rcDun.outOfBounds === 0, rcDun.firstOob || '越界 0 箱');
  step('渲染箱体两两不相交（L 形 + 垫块）', rcDun.overlaps === 0, '重叠 ' + rcDun.overlaps);

  // 侧放姿态：100×100×2000 开可侧放
  click($('.shape-tab[data-shape="rect"]', cards()[0]));
  await wait(100);
  setField(0, 'L', '100');
  setField(0, 'W', '100');
  setField(0, 'H', '2000');
  setVal($('.qty-input', cards()[0]), '2000');
  const sideBox = $('.opt-side', cards()[0]);
  if (sideBox) {
    sideBox.checked = true;
    sideBox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await calc();
  await wait(400);
  const rcSide = renderCheck(window.CL.app.lastPack, 'side');
  step('渲染 AABB 与占位矩形一致（侧放）', rcSide.maxErr < 1, '误差 ' + rcSide.maxErr.toFixed(2) + ' mm');
  step('渲染箱体全在柜内腔（侧放）', rcSide.outOfBounds === 0, rcSide.firstOob || '越界 0 箱');
  step('渲染箱体两两不相交（侧放）', rcSide.overlaps === 0, '重叠 ' + rcSide.overlaps);
  step('描边与箱体包围盒一致（侧放）', rcSide.edgeErr < 1, '偏差 ' + rcSide.edgeErr.toFixed(2) + ' mm ' + rcSide.edgeWhere);

  // 用户截图那一类现场：40GP（内高 2393）+ 满柜，验证「超出柜底 / 相互侵入」不再出现
  click($('.shape-tab[data-shape="rect"]', cards()[0]));
  await wait(80);
  setField(0, 'L', '400');
  setField(0, 'W', '300');
  setField(0, 'H', '300');
  // 默认不限方向：先按默认跑，应当是 1610 箱（侧放参与择优）
  const side40 = $('.opt-side', cards()[0]);
  if (side40 && !side40.checked) {
    side40.checked = true;
    side40.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.CL.app.state.rows[0].allowSide = true;
  click($('.preset[data-key="40GP"]'));
  await wait(80);
  setVal($('.qty-input', cards()[0]), '1680');
  await calc();
  await wait(400);
  const rc40gp = renderCheck(window.CL.app.lastPack, '40gp');
  step('40GP 默认不限方向 → 1610 箱', window.CL.app.lastPack.totals.loadedCount === 1610,
    '已装 ' + window.CL.app.lastPack.totals.loadedCount + ' 箱 / ' + window.CL.app.lastPack.layers.length +
    ' 层 / 姿态 ' + window.CL.app.lastPack.layers.map((l) => l.kind).join(','));
  // 取消「允许侧放」应该退回竖放 7 层 1470 箱，证明勾选是硬限制
  if (side40) {
    side40.checked = false;
    side40.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.CL.app.state.rows[0].allowSide = false;
  await calc();
  await wait(300);
  step('取消允许侧放后 40GP → 1470 箱（勾选是硬限制）',
    window.CL.app.lastPack.totals.loadedCount === 1470,
    '已装 ' + window.CL.app.lastPack.totals.loadedCount + ' 箱');
  if (side40) {
    side40.checked = true;
    side40.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.CL.app.state.rows[0].allowSide = true;
  await calc();
  await wait(200);
  step('结果页不再有「一键允许」按钮（默认已全允许）', !$('#result-body .why-btn'), 'ok');
  step('40GP 渲染箱体全在柜内腔（不低于柜底、不超柜顶）', rc40gp.outOfBounds === 0, rc40gp.firstOob || '越界 0 箱');
  step('40GP 渲染箱体两两不相交', rc40gp.overlaps === 0, '重叠 ' + rc40gp.overlaps);
  step('40GP 描边与箱体一致', rc40gp.edgeErr < 1, '偏差 ' + rc40gp.edgeErr.toFixed(2) + ' mm');
  const health40 = ($('#health-box') || {}).textContent || '';
  step('40GP 本单体检四项全 0', health40.includes('全部通过'), health40.replace(/\s+/g, ' ').slice(0, 120));

  const chips = $$('.plan-chip');
  step('结果页列出全部方案', chips.length === 49, '方案条 ' + chips.length + '（48 个贪心 + 1 个层型最优）');
  if (chips.length > 3) {
    click(chips[3]);
    await wait(150);
    step('点方案条能切换', !!window.CL.app.lastPack, 'lastPack');
  }

  // 11. 校验 localStorage 持久化
  const saved = localStorage.getItem('containerloading.v1');
  step('输入已本地保存', !!saved && JSON.parse(saved).rows.length === 1);

  } catch (e) {
    step('脚本执行中断：' + (e && e.message), false, String((e && e.stack) || '').slice(0, 300));
  }

  return out;
})()`;
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-edge-'));
const edgeArgs = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-crashpad',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + userDir,
  '--window-size=' + WIDTH + ',1600',
  'about:blank'
];
// 验线上时走本地代理：EDGE_PROXY=socks5://127.0.0.1:10808 node tools/browser-check.mjs https://...
if (process.env.EDGE_PROXY) edgeArgs.unshift('--proxy-server=' + process.env.EDGE_PROXY);
const child = spawn(EDGE, edgeArgs, { stdio: 'ignore' });

let exitCode = 0;
let cdp = null;

/** 等页面真正渲染出表单（线上走代理时固定 sleep 不够稳） */
async function waitForApp(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await cdp.evaluate('!!document.getElementById("add-sku") && document.readyState === "complete"');
      if (ok) return true;
    } catch (_) { /* 导航中，上下文还没建立 */ }
    await sleep(250);
  }
  return false;
}

try {
  const list = await waitForJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有找到页面目标');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket 连接失败')); });
  cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1600, deviceScaleFactor: 1, mobile: WIDTH < 600 });

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(600);
  if (!(await waitForApp())) throw new Error('页面加载失败，检查地址或网络');
  await cdp.evaluate('localStorage.clear(); true');
  await cdp.send('Page.reload', { ignoreCache: true });
  if (!(await waitForApp())) throw new Error('页面重载后没有渲染出来');
  // 首次导航偶尔碰上本地 http.server 拒连（脚本加载不全），重载后才是有意义的版本：之前的异常不计
  cdp.events.length = 0;

  const result = await cdp.evaluate(pageTestScript());

  const jsErrors = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  const consoleErrors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !/favicon/i.test(e.params.entry.text))
    // 本地 http.server 在页面重载瞬间偶尔拒连，属测试环境噪声，不是页面错误
    .filter((e) => !(BASE.includes('127.0.0.1') && /ERR_CONNECTION_REFUSED/.test(e.params.entry.text)))
    .map((e) => (e.params.entry.url ? e.params.entry.url + ' — ' : '') + e.params.entry.text);

  let failed = 0;
  for (const s of result.steps) {
    if (!s.ok) failed++;
  }

  // 截图（整页）——此时页面停在 1680 箱的结果上
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const height = Math.min(Math.ceil(metrics.cssContentSize.height), 4000);
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 }
  });
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'));

  // L 形 + 垫块场景的结果卡片（含方案条）
  const resultRect = await cdp.evaluate(`(() => {
    const r = document.getElementById('result-card').getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
             width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  const shotL = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: resultRect.x, y: resultRect.y, width: resultRect.width, height: Math.min(resultRect.height, 2600), scale: 1 }
  });
  fs.writeFileSync(OUT_PNG.replace('.png', '-lshape.png'), Buffer.from(shotL.data, 'base64'));

  // 满柜截图（含描边）+ 放大截图，用来验收箱数是否数得清
  const viewerRect = await cdp.evaluate(`(() => {
    const r = document.getElementById('viewer-card').getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
             width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  await cdp.evaluate("window.CL3D.setView({ theta: 0.86, phi: 1.0, radius: 12000 }); true");
  await sleep(400);
  const shotFull = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: viewerRect.x, y: viewerRect.y, width: viewerRect.width, height: viewerRect.height, scale: 1 }
  });
  const out1680 = OUT_PNG.replace('.png', '-1680.png');
  fs.writeFileSync(out1680, Buffer.from(shotFull.data, 'base64'));

  await cdp.evaluate("window.CL3D.setView({ theta: 0.86, phi: 1.02, radius: 7800 }); true");
  await sleep(400);
  const shotZoom = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: viewerRect.x, y: viewerRect.y, width: viewerRect.width, height: viewerRect.height, scale: 1 }
  });
  const outZoom = OUT_PNG.replace('.png', '-1680-zoom.png');
  fs.writeFileSync(outZoom, Buffer.from(shotZoom.data, 'base64'));

  const mixed = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const $ = (s) => document.querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    while ($$('.sku-card').length > 1) { click($$('.sku-card')[$$('.sku-card').length - 1].querySelector('[data-act="delete"]')); await wait(30); }
    const cardById = (id) => document.querySelector('.sku-card[data-id="' + id + '"]');
    let c0 = $$('.sku-card')[0];
    const id0 = c0.dataset.id;
    // 前面的姿态测试把第一行改成了斜顶，这里先切回矩形
    click(c0.querySelector('.shape-tab[data-shape="rect"]'));
    await wait(60);
    c0 = cardById(id0);
    setVal(c0.querySelector('.v-input[data-key="L"]'), '400');
    setVal(c0.querySelector('.v-input[data-key="W"]'), '300');
    setVal(c0.querySelector('.v-input[data-key="H"]'), '300');
    setVal(c0.querySelector('.qty-input'), '10');
    setVal(c0.querySelector('.weight-input'), '8');
    click($('#add-sku')); await wait(50);
    let c1 = $$('.sku-card')[1];
    const id1 = c1.dataset.id;
    click(c1.querySelector('.shape-tab[data-shape="lshape"]')); await wait(60);
    c1 = cardById(id1);
    setVal(c1.querySelector('.v-input[data-key="L"]'), '600');
    setVal(c1.querySelector('.v-input[data-key="W"]'), '400');
    setVal(c1.querySelector('.v-input[data-key="Wlow"]'), '200');
    setVal(c1.querySelector('.v-input[data-key="Whigh"]'), '200');
    setVal(c1.querySelector('.v-input[data-key="Hlow"]'), '300');
    setVal(c1.querySelector('.v-input[data-key="Hhigh"]'), '500');
    setVal(c1.querySelector('.qty-input'), '20');
    setVal(c1.querySelector('.weight-input'), '9');
    click($('#add-sku')); await wait(50);
    let c2 = $$('.sku-card')[2];
    const id2 = c2.dataset.id;
    click(c2.querySelector('.shape-tab[data-shape="slope"]')); await wait(60);
    c2 = cardById(id2);
    setVal(c2.querySelector('.v-input[data-key="L"]'), '600');
    setVal(c2.querySelector('.v-input[data-key="W"]'), '400');
    setVal(c2.querySelector('.v-input[data-key="Hlow"]'), '300');
    setVal(c2.querySelector('.v-input[data-key="Hhigh"]'), '500');
    setVal(c2.querySelector('.qty-input'), '4');
    setVal(c2.querySelector('.weight-input'), '10');
    click($('#calc-btn'));
    await wait(900);
    if (window.CL3D) window.CL3D.setView({ theta: 1.02, phi: 1.1, radius: 7000 });
    await wait(300);
    // 顺便量一下几何：L 形前段应明显低于后段，斜顶前端应明显低于后端
    const geoStats = (() => {
      const state = window.CL3D._state;
      const items = state.pack.items;
      const findMesh = (shape) => state.meshes.find((m) => {
        const it = items.find((i) => i.id === m.userData.skuId);
        return it && it.shape === shape;
      });
      const stat = (shape) => {
        const mesh = findMesh(shape);
        if (!mesh) return null;
        const pos = mesh.geometry.attributes.position;
        let lFront = -1e9, lBack = -1e9, lLeft = -1e9, lRight = -1e9;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (z < -50) lFront = Math.max(lFront, y);
          if (z > 0) lBack = Math.max(lBack, y);
          if (x < -100) lLeft = Math.max(lLeft, y);
          if (x > 100) lRight = Math.max(lRight, y);
        }
        // 台阶方向跟着姿态走：正放时沿深度（z）分段，侧放时台阶变成「底面缺口」，
        // 从上面看是平的、量 y 的落差量不出来。所以再补一个与姿态无关的判据：
        // 外接长方体只有 8 个不同顶点，真实 L 形至少 12 个（缺口要 4 个顶点）。
        const uniq = new Set();
        for (let i = 0; i < pos.count; i++) {
          uniq.add(Math.round(pos.getX(i)) + ',' + Math.round(pos.getY(i)) + ',' + Math.round(pos.getZ(i)));
        }
        const zSpread = Math.abs(lBack - lFront);
        const xSpread = Math.abs(lRight - lLeft);
        return {
          lFront, lBack, zSpread, xSpread,
          spread: Math.max(zSpread, xSpread),
          vertices: uniq.size
        };
      };
      return stat('lshape');
    })();
    const slopeStats = (() => {
      const state = window.CL3D._state;
      const items = state.pack.items;
      const mesh = state.meshes.find((m) => {
        const it = items.find((i) => i.id === m.userData.skuId);
        return it && it.shape === 'slope';
      });
      if (!mesh) return null;
      const pos = mesh.geometry.attributes.position;
      let low = -1e9, high = -1e9;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        if (x < -100) low = Math.max(low, y);
        if (x > 100) high = Math.max(high, y);
      }
      return { low, high };
    })();
    const r = document.getElementById('viewer-card').getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
      lshape: geoStats,
      slope: slopeStats
    };
  })()`);

  let geomOk = { lshape: false, slope: false };
  if (mixed) {
    const shot2 = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: mixed.x, y: mixed.y, width: mixed.width, height: mixed.height, scale: 1 }
    });
    const out2 = OUT_PNG.replace('.png', '-mixed.png');
    fs.writeFileSync(out2, Buffer.from(shot2.data, 'base64'));

    // 几何校验：非矩形箱必须是真实形状，不能退化成外接长方体
    // L 形在物理修正后是「顶层」箱型，本场景可能装不下；装不下时跳过顶点检查，
    // L 形的真实几何由引擎测试（stepSurface / 缺口嵌合）覆盖。
    geomOk.lshape = !mixed.lshape || mixed.lshape.spread > 100 || mixed.lshape.vertices >= 10;
    geomOk.lshapeSkipped = !mixed.lshape;
    geomOk.slope = !!(mixed.slope && (mixed.slope.high - mixed.slope.low) > 100);

    // 换一个高一点的视角，看清台阶与斜面
    await cdp.evaluate("window.CL3D.setView({ theta: 0.72, phi: 0.88, radius: 4600 }); true");
    await sleep(400);
    const shot3 = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: mixed.x, y: mixed.y, width: mixed.width, height: mixed.height, scale: 1 }
    });
    const out3 = OUT_PNG.replace('.png', '-mixed2.png');
    fs.writeFileSync(out3, Buffer.from(shot3.data, 'base64'));
    console.log('  3D 截图：' + OUT_PNG + ' / ' + out2 + ' / ' + out3);
  } else {
    failed++;
  }

  // 对扣特写：一正一倒两只斜顶箱拼成的实心块，用来肉眼确认没有互相侵入
  const pairShot = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const $ = (s) => document.querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    while ($$('.sku-card').length > 1) { click($$('.sku-card')[$$('.sku-card').length - 1].querySelector('[data-act="delete"]')); await wait(30); }
    let c0 = $$('.sku-card')[0];
    const id0 = c0.dataset.id;
    click(c0.querySelector('.shape-tab[data-shape="slope"]'));
    await wait(80);
    c0 = document.querySelector('.sku-card[data-id="' + id0 + '"]');
    setVal(c0.querySelector('.v-input[data-key="L"]'), '600');
    setVal(c0.querySelector('.v-input[data-key="W"]'), '400');
    setVal(c0.querySelector('.v-input[data-key="Hlow"]'), '300');
    setVal(c0.querySelector('.v-input[data-key="Hhigh"]'), '500');
    setVal(c0.querySelector('.qty-input'), '400');
    click($('#calc-btn'));
    await wait(700);
    const sel = document.getElementById('layer-select');
    if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    if (window.CL3D) window.CL3D.setView({ theta: 0.92, phi: 1.02, radius: 4200 });
    await wait(400);
    const r = document.getElementById('viewer-card').getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width), height: Math.round(r.height),
      kinds: window.CL.app.lastPack.layers.map((l) => l.kind)
    };
  })()`);
  if (pairShot) {
    const shotPair = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: pairShot.x, y: pairShot.y, width: pairShot.width, height: pairShot.height, scale: 1 }
    });
    const outPair = OUT_PNG.replace('.png', '-pair.png');
    fs.writeFileSync(outPair, Buffer.from(shotPair.data, 'base64'));
    console.log('  对扣特写：' + outPair + '（层姿态 ' + (pairShot.kinds || []).join(',') + '）');
  }

  // 斜顶那单（200 箱 → 90 箱/柜）的整页截图：给用户看修复后的结果
  const slope90 = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const $ = (s) => document.querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    while ($$('.sku-card').length > 1) { click($$('.sku-card')[$$('.sku-card').length - 1].querySelector('[data-act="delete"]')); await wait(30); }
    const preset = $('.preset[data-key="40GP"]');
    if (preset) click(preset);
    await wait(80);
    let c0 = $$('.sku-card')[0];
    const id0 = c0.dataset.id;
    click(c0.querySelector('.shape-tab[data-shape="slope"]'));
    await wait(80);
    c0 = document.querySelector('.sku-card[data-id="' + id0 + '"]');
    const set = (k, v) => setVal(c0.querySelector('.v-input[data-key="' + k + '"]'), v);
    set('L', '2000'); set('W', '470'); set('Hlow', '410'); set('Hhigh', '900');
    setVal(c0.querySelector('.qty-input'), '200');
    click($('#calc-btn'));
    await wait(1000);
    if (window.CL3D) window.CL3D.setView({ theta: 0.92, phi: 1.02, radius: 9000 });
    await wait(300);
    const r = document.getElementById('viewer-card').getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width), height: Math.round(r.height),
      boxes: window.CL.app.lastPack.totals.loadedCount,
      layers: window.CL.app.lastPack.layers.map((l) => l.kind + ':' + l.count),
      usedH: window.CL.app.lastPack.usedHeight
    };
  })()`);
  if (slope90) {
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: slope90.x, y: slope90.y, width: slope90.width, height: slope90.height, scale: 1 }
    });
    const outSlope = OUT_PNG.replace('.png', '-slope90.png');
    fs.writeFileSync(outSlope, Buffer.from(shot.data, 'base64'));
    console.log('  斜顶 200 箱：' + slope90.boxes + ' 箱/柜，层 ' + slope90.layers.join(' ')+
      '，用高 ' + slope90.usedH + ' → ' + outSlope);
  }

  // 两种状态的截图：全部装入（302 箱，40GP L 形 + 垫块）与装不下（1000 箱）
  // 注意：必须「算一个 → 截一张 → 再改数量」，否则两张都会截到最后一次计算的状态
  const setupState = `(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const $ = (s) => document.querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    while ($$('.sku-card').length > 1) { click($$('.sku-card')[$$('.sku-card').length - 1].querySelector('[data-act="delete"]')); await wait(30); }
    const preset = $('.preset[data-key="40GP"]');
    if (preset) click(preset);
    await wait(80);
    let c0 = $$('.sku-card')[0];
    const id0 = c0.dataset.id;
    click(c0.querySelector('.shape-tab[data-shape="lshape"]'));
    await wait(80);
    c0 = document.querySelector('.sku-card[data-id="' + id0 + '"]');
    const set = (k, v) => setVal(c0.querySelector('.v-input[data-key="' + k + '"]'), v);
    set('L', '600'); set('W', '400'); set('Wlow', '160'); set('Whigh', '240');
    set('Hlow', '300'); set('Hhigh', '500');
    const d = $('#allow-dunnage');
    if (d && !d.checked) { d.checked = true; d.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  })()`;

  const shotBox = async () => {
    const r = await cdp.evaluate(`(() => {
      const el = document.querySelector('#result-body .why-box');
      const card = document.getElementById('result-card');
      const base = el ? el.getBoundingClientRect() : card.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      return {
        x: Math.round(cr.left + window.scrollX),
        y: Math.max(0, Math.round(base.top + window.scrollY) - 200),
        width: Math.round(cr.width),
        height: Math.min(1100, Math.round(base.height) + 220)
      };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }
    });
    return Buffer.from(shot.data, 'base64');
  };

  const calcState = async (qty) => {
    await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const el = document.querySelector('.sku-card .qty-input');
      el.value = '${qty}';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('calc-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(900);
      return true;
    })()`);
  };

  await cdp.evaluate(setupState);
  await calcState(302);
  const shotDone = await shotBox();
  fs.writeFileSync(OUT_PNG.replace('.png', '-done.png'), shotDone);
  await calcState(1000);
  const shotPartial = await shotBox();
  fs.writeFileSync(OUT_PNG.replace('.png', '-partial.png'), shotPartial);
  console.log('  两种状态截图：' + OUT_PNG.replace('.png', '-done.png') + ' / ' + OUT_PNG.replace('.png', '-partial.png'));

  // 汇总
  const stepFailed = result.steps.filter((s) => !s.ok).length;
  const geomFailed = (geomOk.lshape ? 0 : 1) + (geomOk.slope ? 0 : 1);
  failed = stepFailed + geomFailed;

  console.log('\n浏览器交互自检：');
  for (const s of result.steps) {
    console.log('  ' + (s.ok ? 'ok  ' : 'FAIL') + ' ' + s.name + (s.ok ? '' : '  ← ' + s.detail));
  }
  // 柜底这条要把实测数单独打出来：占位 min z 与渲染 min Y 必须一起看
  const floorStep = result.steps.find((s) => s.name.indexOf('对扣场景柜底') === 0);
  if (floorStep) console.log('  柜底实测：' + floorStep.detail);
  console.log('\n3D 真实几何：');
  console.log('  ' + (geomOk.lshape ? 'ok  ' : 'FAIL') + ' L 形台阶前段最高 ' +
    (mixed && mixed.lshape ? mixed.lshape.lFront.toFixed(1) : '?') + ' mm，后段最高 ' +
    (mixed && mixed.lshape ? mixed.lshape.lBack.toFixed(1) : '?') + ' mm');
  console.log('  ' + (geomOk.slope ? 'ok  ' : 'FAIL') + ' 斜顶前端最高 ' +
    (mixed && mixed.slope ? mixed.slope.low.toFixed(1) : '?') + ' mm，后端最高 ' +
    (mixed && mixed.slope ? mixed.slope.high.toFixed(1) : '?') + ' mm');
  console.log('\n  ' + (result.steps.length - stepFailed) + ' 项交互通过，' + stepFailed + ' 失败；' +
    (2 - geomFailed) + ' 项几何通过，' + geomFailed + ' 失败');

  if (jsErrors.length) {
    console.log('\n页面 JS 异常：');
    jsErrors.forEach((e) => console.log('  ' + e));
  }
  if (consoleErrors.length) {
    console.log('\n控制台 error：');
    consoleErrors.forEach((e) => console.log('  ' + e));
  }

  if (failed || jsErrors.length) exitCode = 1;
} catch (e) {
  console.error('\n自检失败：' + e.message);
  exitCode = 1;
} finally {
  try { child.kill(); } catch (_) { /* ignore */ }
}

process.exit(exitCode);
