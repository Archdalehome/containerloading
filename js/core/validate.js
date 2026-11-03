/*
 * 校验层：集装箱参数、单行纸箱参数、整单汇总。
 * 纯函数，不碰 DOM；返回结构化错误，交给 UI 渲染。
 *
 * 错误级别：
 *   error  —— 无法计算，必须改
 *   warn   —— 可以算，但需要用户知道（例如没填单箱重量，载重无法判断）
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.shapes && typeof require === 'function') NS.shapes = require('./shapes.js');
  var S = NS.shapes;
  var toNum = S.toNum;
  var num = S.num;

  var CONTAINER_FIELDS = [
    { key: 'innerL', label: '内长', unit: 'mm' },
    { key: 'innerW', label: '内宽', unit: 'mm' },
    { key: 'innerH', label: '内高', unit: 'mm' },
    { key: 'doorH', label: '门高', unit: 'mm' },
    { key: 'payload', label: '最大载重', unit: 'kg' }
  ];

  function containerErrors(c) {
    var errs = [];
    for (var i = 0; i < CONTAINER_FIELDS.length; i++) {
      var f = CONTAINER_FIELDS[i];
      var n = toNum(c[f.key]);
      if (!Number.isFinite(n)) {
        errs.push({ field: f.key, level: 'error', message: '请填写集装箱' + f.label + '（' + f.unit + '）' });
      } else if (n <= 0) {
        errs.push({ field: f.key, level: 'error', message: '集装箱' + f.label + '必须大于 0' });
      }
    }
    var doorH = toNum(c.doorH);
    var innerH = toNum(c.innerH);
    if (Number.isFinite(doorH) && Number.isFinite(innerH) && doorH > innerH) {
      errs.push({ field: 'doorH', level: 'warn', message: '门高 ' + num(doorH) + ' mm 大于内高 ' + num(innerH) + ' mm，请核对参数' });
    }
    return errs;
  }

  /** 单行纸箱校验；container 用来判断门高/内宽/内长。 */
  function rowErrors(row, container) {
    var shape = S.get(row.shape);
    var errs = [];

    var shapeErrs = shape.checks(row.values || {});
    for (var i = 0; i < shapeErrs.length; i++) {
      errs.push({ field: shapeErrs[i].field, level: 'error', message: shapeErrs[i].message });
    }

    var qty = toNum(row.qty);
    if (!Number.isFinite(qty)) {
      errs.push({ field: 'qty', level: 'error', message: '请填写数量（正整数）' });
    } else if (qty <= 0 || Math.abs(qty - Math.round(qty)) > 1e-9) {
      errs.push({ field: 'qty', level: 'error', message: '数量必须是大于 0 的整数' });
    }

    var weightRaw = row.weight === null || row.weight === undefined ? '' : String(row.weight).trim();
    if (weightRaw !== '') {
      var w = toNum(weightRaw);
      if (!Number.isFinite(w) || w < 0) {
        errs.push({ field: 'weight', level: 'error', message: '单箱重量必须是不小于 0 的数字，或留空' });
      } else if (w === 0) {
        errs.push({ field: 'weight', level: 'warn', message: '单箱重量为 0，载重判断会失真' });
      } else {
        // 单箱就超过整柜载重：这一柜一箱都装不了，必须直接说清，不能算出 0 箱让用户猜
        var payload = toNum(container && container.payload);
        if (Number.isFinite(payload) && payload > 0 && w > payload + 1e-9) {
          errs.push({
            field: 'weight', level: 'error',
            message: '单箱重 ' + num(w) + ' kg 超过 ' + ((container && container.key) || '本柜') +
              ' 载重上限 ' + num(payload) + ' kg，单个柜连一箱都装不了'
          });
        }
      }
    } else {
      errs.push({ field: 'weight', level: 'warn', message: '未填单箱重量，无法判断是否超载' });
    }

    // 只有尺寸本身没问题时，才做集装箱相关判断，避免刷一堆关联错误
    if (shapeErrs.length > 0) return errs;

    var bb = shape.bbox(row.values || {});
    var cKey = (container && container.key) || '集装箱';
    var innerH = toNum(container && container.innerH);
    var doorH = toNum(container && container.doorH);
    var innerW = toNum(container && container.innerW);
    var innerL = toNum(container && container.innerL);
    var heightKey = shape.heightKey || 'H';

    // 默认不限方向：只要「存在一种朝向」能过门、进得去，就不算超尺寸。
    // 例如 3000×2500×500 立起来是 2500 高、500 宽，40HQ 门高 2585 装得进去。
    var dims = [bb.l, bb.w, bb.h];
    var orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    var fitOrient = null;
    var tol = 1e-9;
    for (var oi = 0; oi < orders.length; oi++) {
      var o = orders[oi];
      var len = dims[o[0]];
      var wid = dims[o[1]];
      var hei = dims[o[2]];
      if (Number.isFinite(innerL) && len > innerL + tol) continue;
      if (Number.isFinite(innerW) && wid > innerW + tol) continue;
      if (Number.isFinite(doorH) && hei > doorH + tol) continue;
      if (Number.isFinite(innerH) && hei > innerH + tol) continue;
      fitOrient = { len: len, wid: wid, hei: hei, order: o };
      break;
    }

    if (!fitOrient) {
      // 一个朝向都放不进：说清是「底面积」还是「高度」卡住，别只说尺寸超了
      var sorted = dims.slice().sort(function (a, b) { return a - b; }); // [最薄, 中, 最长]
      var minFootprintA = sorted[0];
      var minFootprintB = sorted[1];
      var minHeight = sorted[0];
      var heightBlocked = Number.isFinite(doorH) && minHeight > doorH + tol;
      var footprintBlocked = Number.isFinite(innerW) && minFootprintA > innerW + tol;
      var msg;
      if (heightBlocked) {
        msg = '任何朝向都放不进：最薄的一面也有 ' + num(minHeight) + ' mm，超过 ' + cKey +
          ' 门高 ' + num(doorH) + ' mm';
      } else if (footprintBlocked) {
        msg = '任何朝向都放不进：最小可落地底面 ' + num(minFootprintA) + '×' + num(minFootprintB) +
          ' mm 超过 ' + cKey + ' 内宽 ' + num(innerW) + ' mm';
      } else {
        msg = '任何朝向都放不进：' + num(bb.l) + '×' + num(bb.w) + '×' + num(bb.h) +
          ' mm 在 ' + cKey + ' 的内长 ' + num(innerL) + ' / 内宽 ' + num(innerW) +
          ' / 门高 ' + num(doorH) + ' mm 里没有可行朝向';
      }
      errs.push({ field: heightKey, level: 'error', message: msg });
      return errs;
    }

    // 需要立放/侧放才能装：不拦，但提示用户算法会这么摆（界面上也能看到层高）
    var uprightFits = Math.abs(fitOrient.hei - bb.h) < 1e-9;
    if (!uprightFits) {
      errs.push({
        field: heightKey, level: 'warn',
        message: '这个箱子要换个方向才装得进：按 ' + num(fitOrient.len) + '×' + num(fitOrient.wid) +
          ' 底面放、占用 ' + num(fitOrient.hei) + ' mm 高'
      });
    }

    return errs;
  }

  /** 单行统计（不判断能否装，仅按输入算数）。 */
  function rowSummary(row) {
    var shape = S.get(row.shape);
    var v = row.values || {};
    var bb = shape.bbox(v);
    var qty = toNum(row.qty);
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    var netVol = shape.volume(v);
    var outerVol = bb.l * bb.w * bb.h;
    var weight = toNum(row.weight);
    var hasWeight = row.weight !== '' && row.weight !== null && row.weight !== undefined && Number.isFinite(weight);
    return {
      shape: shape.key,
      shapeName: shape.name,
      bbox: bb,
      netVolume: Number.isFinite(netVol) ? netVol : 0,
      outerVolume: Number.isFinite(outerVol) ? outerVol : 0,
      netTotal: (Number.isFinite(netVol) ? netVol : 0) * qty,
      outerTotal: (Number.isFinite(outerVol) ? outerVol : 0) * qty,
      qty: qty,
      unitWeight: hasWeight ? weight : null,
      totalWeight: hasWeight ? weight * qty : null
    };
  }

  /**
   * 整单校验。
   * state = { container: {...}, rows: [...] }
   * 返回 {
   *   ok: 无 error,
   *   containerErrors, rowErrors: { rowId: [...] },
   *   summary: { rows: [...], totals: {...} }
   * }
   */
  function all(state) {
    var cErrs = containerErrors(state.container || {});
    var byRow = {};
    var rows = state.rows || [];
    var errorCount = 0;
    var warnCount = 0;

    for (var i = 0; i < rows.length; i++) {
      var errs = rowErrors(rows[i], state.container || {});
      byRow[rows[i].id] = errs;
      for (var j = 0; j < errs.length; j++) {
        if (errs[j].level === 'error') errorCount++;
        else warnCount++;
      }
    }
    for (var k = 0; k < cErrs.length; k++) {
      if (cErrs[k].level === 'error') errorCount++;
      else warnCount++;
    }
    if (rows.length === 0) errorCount++;

    var summaries = [];
    var totals = { netVolume: 0, outerVolume: 0, qty: 0, weight: 0, hasAllWeight: true, skuCount: 0 };
    for (var m = 0; m < rows.length; m++) {
      var s = rowSummary(rows[m]);
      summaries.push({ id: rows[m].id, name: (rows[m].name || '').trim(), summary: s });
      totals.netVolume += s.netTotal;
      totals.outerVolume += s.outerTotal;
      totals.qty += s.qty;
      if (s.totalWeight === null) totals.hasAllWeight = false;
      else totals.weight += s.totalWeight;
      totals.skuCount++;
    }

    return {
      ok: errorCount === 0,
      errorCount: errorCount,
      warnCount: warnCount,
      containerErrors: cErrs,
      rowErrors: byRow,
      rows: summaries,
      totals: totals
    };
  }

  NS.validate = {
    containerFields: CONTAINER_FIELDS,
    containerErrors: containerErrors,
    rowErrors: rowErrors,
    rowSummary: rowSummary,
    all: all
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.validate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
