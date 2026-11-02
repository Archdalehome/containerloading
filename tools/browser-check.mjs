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
const OUT_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshot.png');

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

  // 4. 改成一致 → 通过
  setField(1, 'W', '400');
  await calc();
  step('修正后校验通过', $('#result-card').classList.contains('is-ok'), $('#result-title').textContent);
  step('汇总表两行数据', $$('#result-body .tbl tbody tr').length === 2);
  step('汇总含净体积合计', $('#result-body').textContent.includes('净体积合计'));
  const firstRow = $('#result-body .tbl tbody tr');
  step('第1行 100 箱净体积 3.600 m³', firstRow.children[6].textContent.trim() === '3.600', firstRow.children[6].textContent);

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

  // 8. 改回 40HQ，恢复正常数据，截屏
  click($('.preset[data-key="40HQ"]'));
  await wait(50);
  setField(1, 'Hhigh', '500');
  await calc();
  step('恢复后通过', $('#result-card').classList.contains('is-ok'));

  // 8. 校验 localStorage 持久化
  const saved = localStorage.getItem('containerloading.v1');
  step('输入已本地保存', !!saved && JSON.parse(saved).rows.length === 2);

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
  '--window-size=1280,1600',
  'about:blank'
], { stdio: 'ignore' });

let exitCode = 0;
let cdp = null;

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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(1200);
  await cdp.evaluate('localStorage.clear(); true');
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1200);

  const result = await cdp.evaluate(pageTestScript());

  const jsErrors = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  const consoleErrors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !/favicon/i.test(e.params.entry.text))
    .map((e) => e.params.entry.text);

  console.log('\n浏览器交互自检：');
  let failed = 0;
  for (const s of result.steps) {
    if (!s.ok) failed++;
    console.log('  ' + (s.ok ? 'ok  ' : 'FAIL') + ' ' + s.name + (s.ok ? '' : '  ← ' + s.detail));
  }
  console.log('\n  ' + (result.steps.length - failed) + ' 通过，' + failed + ' 失败');

  if (jsErrors.length) {
    console.log('\n页面 JS 异常：');
    jsErrors.forEach((e) => console.log('  ' + e));
  }
  if (consoleErrors.length) {
    console.log('\n控制台 error：');
    consoleErrors.forEach((e) => console.log('  ' + e));
  }

  // 截图（整页）
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const height = Math.min(Math.ceil(metrics.cssContentSize.height), 4000);
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1280, height, scale: 1 }
  });
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'));
  console.log('\n  截图：' + OUT_PNG);

  if (failed || jsErrors.length) exitCode = 1;
} catch (e) {
  console.error('\n自检失败：' + e.message);
  exitCode = 1;
} finally {
  try { child.kill(); } catch (_) { /* ignore */ }
}

process.exit(exitCode);
