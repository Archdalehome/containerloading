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

    var overInner = Number.isFinite(innerH) && bb.h > innerH + 1e-9;
    var overDoor = Number.isFinite(doorH) && bb.h > doorH + 1e-9;

    if (overInner) {
      errs.push({
        field: heightKey, level: 'error',
        message: '此箱型高 ' + num(bb.h) + ' mm，超过 ' + cKey + ' 内高 ' + num(innerH) +
          ' mm（门高 ' + num(doorH) + ' mm），无法装入。'
      });
    } else if (overDoor) {
      // 关键约束：柜内再高也没用，箱体必须先过柜门
      errs.push({
        field: heightKey, level: 'error',
        message: '此箱型高 ' + num(bb.h) + ' mm，超过 ' + cKey + ' 门高 ' + num(doorH) +
          ' mm，无法通过柜门装入。'
      });
    }

    var narrow = Math.min(bb.l, bb.w);
    var wide = Math.max(bb.l, bb.w);
    if (Number.isFinite(innerW) && narrow > innerW + 1e-9) {
      errs.push({
        field: 'W', level: 'error',
        message: '底面 ' + num(bb.l) + '×' + num(bb.w) + ' mm 的最短边 ' + num(narrow) +
          ' mm 超过 ' + cKey + ' 内宽 ' + num(innerW) + ' mm，第一版货架排布放不下。'
      });
    } else if (Number.isFinite(innerL) && wide > innerL + 1e-9) {
      errs.push({
        field: 'L', level: 'error',
        message: '底面最长边 ' + num(wide) + ' mm 超过 ' + cKey + ' 内长 ' + num(innerL) + ' mm，装不进去。'
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
