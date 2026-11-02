# 集装箱装柜计算器（Container Loading）

输入纸箱尺寸、形状和数量，选集装箱规格，算出能装多少、怎么排，并生成可旋转的 3D 装柜图。
纯静态页面（HTML + CSS + 原生 JS，无构建步骤、无 CDN），部署在 Cloudflare Pages。

## 当前进度

- **M1 骨架与校验：完成** — 三种箱型表单、集装箱规格（可改）、完整参数校验、本地保存
- **M2 排布算法与指标：完成** — 分层装载、每 SKU 装载/剩余、体积装载率、总重与超载、分层明细
- **M3 3D 装柜图：完成** — three.js 本地 vendor，拖动旋转 / 滚轮缩放、按层筛选、图例高亮、尺寸标注
- M4 层切换强化 / 导出装柜清单 / 使用说明：未开始

线上地址：https://containerloading.pages.dev （push main 自动部署）

## 本地运行

```bash
cd containerloading
python -m http.server 8080
# 打开 http://127.0.0.1:8080/
```

页面是静态文件，但用了浏览器脚本，请通过本地服务访问（直接双击 index.html 也能打开，只是本地保存可能被浏览器策略限制）。

## 自检

```bash
node tests/core.test.js          # 表单/几何/校验（17 项）
node tests/pack.test.js          # 排布算法：1680 基准 + 随机 200 组不越界不重叠（13 项）
node tools/browser-check.mjs     # 真实浏览器点击测试（36 项）+ 2 项 3D 几何 + 截图，需先起本地服务
CHECK_WIDTH=390 node tools/browser-check.mjs   # 手机宽度再跑一遍
```

`tools/browser-check.mjs` 用 Edge headless + DevTools Protocol 驱动页面：真点按钮、真输入、真触发计算，
并把整页截图存到 `tools/screenshot.png`。改了 UI 之后跑一遍再推。

## 目录

```
index.html                 页面结构
css/style.css              样式
js/core/shapes.js          三种箱型：字段、净体积、外接长方体、几何校验
js/core/containers.js      集装箱内置规格
js/core/validate.js        校验与整单汇总（纯函数）
js/core/pack.js            分层装载算法（纯函数，返回每箱坐标）
js/core/storage.js         localStorage 保存
js/ui/viewer.js            3D 装柜图（three.js，ES module）
vendor/three.module.min.js three.js 本地文件（不走 CDN）
js/core/init.js            Node 端模块装配（自检用）
js/ui/container-panel.js   集装箱规格面板
js/ui/sku-rows.js          纸箱清单（加行、删行、切形状、实时摘要）
js/ui/result.js            结果面板
js/app.js                  入口与事件接线
tests/core.test.js         表单与校验自检
tests/pack.test.js         排布算法自检
tools/browser-check.mjs    浏览器交互自检
tools/verify-live.py       线上验收（走 SOCKS5 + OpenSSL）
tools/fetch-vendor.py      下载 vendor 依赖
carton-shape/              三种箱型参考图（仅作说明，页面不引用）
```

## 单位与约束

- 内部计算一律 **毫米（mm）**，重量 **千克（kg）**；显示时换算成米 / 立方米。
- **箱体高度不得超过门高**：40HQ 内高 2698 但门高只有 2585，超过门高的箱子进不去。
  超过内高报内高错误，超过门高但低于内高报门高错误。
- 单箱底面最短边超过内宽、或最长边超过内长时直接判为装不进去。

## 排布口径（第一版）

L 形箱与斜顶箱的**净体积**按真实几何计算，但**排布**一律按**外接长方体**占位（保守估算），
3D 图中按真实几何渲染。形状咬合、翻转嵌套排布属于第二版，第一版不做，界面上已明确写出这一点。

## 内置集装箱参数（可改）

| 规格 | 内长 | 内宽 | 内高 | 门高 | 最大载重 |
|---|---|---|---|---|---|
| 20GP | 5898 | 2352 | 2393 | 2280 | 28200 kg |
| 40GP | 12032 | 2352 | 2393 | 2280 | 26700 kg |
| 40HQ | 12032 | 2352 | 2698 | 2585 | 26500 kg |
| 45HQ | 13556 | 2352 | 2698 | 2585 | 27600 kg |

## M2 算法（已实现：js/core/pack.js）

按外接体积从大到小，逐层装：每层取当前最大且未装完的 SKU，用它的外接底面在 L×W 内货架式排布
（沿宽排一行、整行推进），允许水平 90° 旋转并取每层箱数多的朝向；层厚 = 箱高；
累加层高超过内高、或累计重量超过最大载重就停。结果给出每箱 (x, y, z) 与朝向。

基准例：400×300×300 装 40HQ（12032×2352×2698），重量不设限
- 朝向 A：沿长 12032 ÷ 400 = 30，沿宽 2352 ÷ 300 = 7 → 每层 210
- 朝向 B：沿长 12032 ÷ 300 = 40，沿宽 2352 ÷ 400 = 5 → 每层 200
- 取 A 朝向：每层 210，8 层（8 × 300 = 2400 ≤ 2698）→ **1680 箱**
- 净体积 1680 × 0.036 = 60.48 m³；柜内容积 76.351 m³；装载率 **79.2%**
- 载重：每箱 > 15.77 kg 时先撞 26500 kg 上限（1680 × 15.77 ≈ 26500）

这条基准写在 `js/core/pack.js` 注释与 `tests/pack.test.js` 断言里，跑测试就是在核对它。

已知取舍（第二版再做）：
- 一层只放一个 SKU，层内放不满的剩余空间不用其他 SKU 补位
- 不做形状咬合 / 翻转嵌套，L 形箱与斜顶箱一律按外接长方体占位
- 单次计算上限 50000 箱，超出会截断并提示

## 3D（js/ui/viewer.js）

- three.js 0.160.0 的 module 版放在 `vendor/`，`index.html` 用 `<script type="module">` 引入，没有任何 CDN 请求。
- 坐标：three.X = 柜长、three.Y = 高、three.Z = 柜宽；场景把柜子居中，轨道相机绕柜心转。
- 箱体几何：矩形是 BoxGeometry；L 形箱按「前段低、后段高」两段拼出真实台阶；斜顶箱按梯形截面挤出真实斜面。
  排布位置仍是外接长方体口径，所以真实形状与外接体之间的空隙就是保守留空。
- 每箱缩 4mm 只为视觉缝隙（只作用于渲染，不动排布数据）。
- 交互：左键拖动旋转、滚轮缩放、右键/Shift 拖动平移；图例点选高亮某个箱型；「显示」下拉只看第 N 层。
- 尺寸标注（内长/内宽/内高/柜门）是 HTML 叠加层，每帧按相机投影定位。

