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
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
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

  // 5. 门高约束：箱高 2600 > 40HQ 门高 2585
  setField(1, 'Hhigh', '2600');
  await calc();
  const doorMsg = $('#result-body').textContent;
  step('超门高被拦下', $('#result-card').classList.contains('is-error'));
  step('提示写明门高 2585', doorMsg.includes('门高 2585'), doorMsg.slice(0, 160));

  // 6. 切 20GP → 门高 2280
  click($('.preset[data-key="20GP"]'));
  await wait(50);
  step('切换 20GP 生效', $('#spec-innerL').value === '5898' && $('#spec-doorH').value === '2280', '内长=' + $('#spec-innerL').value + ' 门高=' + $('#spec-doorH').value);
  await calc();
  step('20GP 门高 2280 提示', $('#result-body').textContent.includes('门高 2280'));

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

  // 9. 3D 图
  await wait(400);
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

  const csv = window.CL.report.buildCsv(window.CL.app.lastPack, window.CL.app.state, { extra: window.CL.app.lastPack.extra });
  step('CSV 生成正常（入口等 v2 姿态定稿再开放）', csv.includes('分层小计') && csv.includes('逐箱明细') && csv.includes('列号') && csv.split('\\r\\n').length > 200, '长度 ' + csv.length);
  step('导出入口暂时收起来', !$('#export-btn'));

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
  step('斜顶默认是正放层', window.CL.app.lastPack.layers[0].kind === 'normal', window.CL.app.lastPack.layers[0].kind);

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
const child = spawn(EDGE, [
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
], { stdio: 'ignore' });

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
    setVal(c0.querySelector('.qty-input'), '30');
    setVal(c0.querySelector('.weight-input'), '8');
    click($('#add-sku')); await wait(50);
    let c1 = $$('.sku-card')[1];
    const id1 = c1.dataset.id;
    click(c1.querySelector('.shape-tab[data-shape="lshape"]')); await wait(60);
    c1 = cardById(id1);
    setVal(c1.querySelector('.v-input[data-key="L"]'), '600');
    setVal(c1.querySelector('.v-input[data-key="W"]'), '400');
    setVal(c1.querySelector('.v-input[data-key="Wlow"]'), '160');
    setVal(c1.querySelector('.v-input[data-key="Whigh"]'), '240');
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
    setVal(c2.querySelector('.qty-input'), '12');
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
        let lFront = -1e9, lBack = -1e9, sLow = -1e9, sHigh = -1e9;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          if (z < -50) lFront = Math.max(lFront, y);
          if (z > 0) lBack = Math.max(lBack, y);
          if (x < -100) sLow = Math.max(sLow, y);
          if (x > 100) sHigh = Math.max(sHigh, y);
        }
        return { lFront, lBack, sLow, sHigh };
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
    geomOk.lshape = !!(mixed.lshape && (mixed.lshape.lBack - mixed.lshape.lFront) > 100);
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

  // 汇总
  const stepFailed = result.steps.filter((s) => !s.ok).length;
  const geomFailed = (geomOk.lshape ? 0 : 1) + (geomOk.slope ? 0 : 1);
  failed = stepFailed + geomFailed;

  console.log('\n浏览器交互自检：');
  for (const s of result.steps) {
    console.log('  ' + (s.ok ? 'ok  ' : 'FAIL') + ' ' + s.name + (s.ok ? '' : '  ← ' + s.detail));
  }
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
