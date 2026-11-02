/*
 * 装柜清单导出（CSV）。纯函数，可在 Node 里直接测。
 * 内容：基本信息 → 分层小计 → 逐箱明细（层号、列号、排号、朝向）。
 * 用 UTF-8 BOM，Excel 直接双击打开不乱码。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});

  function m3(mm3) {
    return (mm3 / 1e9).toFixed(3);
  }

  function kg(n) {
    return String(Math.round(n * 10) / 10);
  }

  function pct(x) {
    return (Math.round(x * 1000) / 10).toFixed(1) + '%';
  }

  /** CSV 字段转义：含逗号、引号、换行就加引号 */
  function cell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function line(arr) {
    return arr.map(cell).join(',');
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function stamp(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fileStamp(d) {
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes());
  }

  function poseLabel(p) {
    if (p.kind === 'pair-upper') return '倒放（对扣上件，翻转 180°）';
    if (p.kind === 'pair-lower') return '正放（对扣下件）';
    if (p.kind === 'fill') return '填缝（正放）';
    if (p.kind === 'side') return '侧放';
    if (p.kind === 'flip') return '倒放';
    if (p.pose && p.pose[8] === -1) return '倒放';
    return '正放';
  }

  /** 每层小计 */
  function layerRows(pack) {
    var byLayer = {};
    pack.placements.forEach(function (p) {
      byLayer[p.layer] = byLayer[p.layer] || { count: 0, minX: Infinity, maxX: -Infinity };
      var b = byLayer[p.layer];
      b.count++;
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x + p.l);
    });
    return pack.layers.map(function (L) {
      var b = byLayer[L.index] || { minX: 0, maxX: 0 };
      return {
        layer: L.index + 1,
        shapeName: L.shapeName,
        name: L.skuName || '',
        count: L.count,
        capacity: L.capacity,
        height: L.height,
        bottom: L.z,
        top: L.top,
        rot: L.rot,
        usedLength: b.maxX - b.minX
      };
    });
  }

  /**
   * 生成 CSV 文本。
   * pack = CL.pack.run(...) 的结果
   * state = { container, rows }
   * opts = { extra, now: Date }
   */
  function buildCsv(pack, state, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var extra = opts.extra || null;
    var t = pack.totals;
    var c = pack.container;
    var out = [];
    var nameById = {};
    pack.items.forEach(function (it) {
      nameById[it.id] = it.name || (it.shapeName + ' #' + (it.index + 1));
    });

    var totalContainers = 1 + (extra ? extra.count : 0);

    out.push(line(['集装箱装柜清单']));
    out.push(line(['集装箱规格', c.key]));
    out.push(line(['内尺寸(mm)', c.innerL + ' × ' + c.innerW + ' × ' + c.innerH]));
    out.push(line(['门高(mm)', c.doorH]));
    out.push(line(['最大载重(kg)', c.payload]));
    out.push(line(['已装箱数', t.loadedCount + ' / ' + t.requestedCount]));
    out.push(line(['净体积(m³)', m3(t.netVolume)]));
    out.push(line(['体积装载率', pct(t.fillRate)]));
    out.push(line(['总重(kg)', t.weightKnown ? kg(t.weight) : '未填单箱重']));
    out.push(line(['所需柜数', totalContainers + ' 个 ' + c.key +
      (extra && extra.count ? '（本柜 + ' + extra.count + ' 个）' : '（全部装进本柜）')]));
    out.push(line(['导出时间', stamp(now)]));
    out.push('');

    out.push(line(['分层小计（自下而上）']));
    out.push(line(['层号', '箱型', '名称', '箱数', '单层容量', '层高(mm)', '层底(mm)', '层顶(mm)', '姿态']));
    layerRows(pack).forEach(function (L) {
      var pose = L.kind === 'pair' ? '对扣（一正一倒）'
        : L.kind === 'side' ? '侧放'
          : L.kind === 'flip' ? '倒放' : '正放';
      out.push(line([L.layer, L.shapeName, L.name, L.count, L.capacity, L.height, L.bottom, L.top, pose]));
    });
    out.push('');

    out.push(line(['逐箱明细']));
    out.push(line(['序号', '层号', '列号', '排号', '箱型', '名称', '姿态',
      'X(mm)', 'Y(mm)', 'Z(mm)', '箱长(mm)', '箱宽(mm)', '箱高(mm)', '净体积(m³)', '单箱重(kg)', '合计重(kg)']));

    var itemById = {};
    pack.items.forEach(function (it) { itemById[it.id] = it; });

    pack.placements.forEach(function (p, i) {
      var it = itemById[p.skuId] || {};
      out.push(line([
        i + 1, p.layer + 1, p.col, p.row,
        it.shapeName || '', nameById[p.skuId] || '', poseLabel(p),
        p.x, p.y, p.z, p.l, p.w, p.h,
        m3(it.netVolumeEach || 0),
        it.unitWeight === null || it.unitWeight === undefined ? '' : kg(it.unitWeight),
        it.unitWeight === null || it.unitWeight === undefined ? '' : kg(it.unitWeight)
      ]));
    });

    return '\uFEFF' + out.join('\r\n') + '\r\n';
  }

  function suggestName(pack, now) {
    now = now || new Date();
    return '装柜清单_' + (pack.container.key || '柜型') + '_' + fileStamp(now) + '.csv';
  }

  NS.report = {
    buildCsv: buildCsv,
    layerRows: layerRows,
    suggestName: suggestName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.report;
})(typeof globalThis !== 'undefined' ? globalThis : this);
