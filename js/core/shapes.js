/*
 * 三种纸箱形状：字段定义、净体积、外接长方体、几何校验。
 * 单位统一 mm。本文件不碰 DOM，浏览器与 Node 均可加载（自检用）。
 *
 * 形状口径：
 *   rect   矩形箱：L × W × H
 *   lshape L形箱：沿长度方向截面不变，前段深 W低 高 H低，后段深 W高 高 H高；
 *                  W低 + W高 = W 总深，H低 < H高。
 *                  净体积 = L * (W低*H低 + W高*H高)
 *   slope  斜顶箱：顶面沿长度方向线性倾斜，前端高 H底，后端高 H高，H底 < H高。
 *                  净体积 = L * W * (H底 + H高) / 2
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});

  /** mm 容差：允许 0.5mm 的输入舍入误差（尺寸可带小数）。 */
  var EPS = 0.5;

  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim().replace(/,/g, '');
    if (s === '') return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function num(n) {
    if (!Number.isFinite(n)) return '—';
    return String(Math.round(n * 100) / 100);
  }

  function positiveErrors(shape, values) {
    var errs = [];
    for (var i = 0; i < shape.fields.length; i++) {
      var f = shape.fields[i];
      var n = toNum(values[f.key]);
      if (!Number.isFinite(n)) {
        errs.push({ field: f.key, message: '请填写' + f.label + '（正数，单位 mm）' });
      } else if (n <= 0) {
        errs.push({ field: f.key, message: f.label + ' 必须大于 0' });
      }
    }
    return errs;
  }

  function badSet(errs) {
    var set = {};
    for (var i = 0; i < errs.length; i++) set[errs[i].field] = true;
    return set;
  }

  var ICONS = {
    rect: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 10 16 4l12 6v12l-12 6L4 22V10Z"/><path d="M4 10l12 6 12-6M16 16v12"/></svg>',
    lshape: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 27V9h9v6h8v12H3Z"/><path d="M12 9v6h8"/></svg>',
    slope: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 27V15L26 8v19H3Z"/><path d="M3 15h23"/></svg>'
  };

  var SHAPES = {
    rect: {
      key: 'rect',
      name: '矩形箱',
      short: '矩形',
      tagline: 'L × W × H',
      icon: ICONS.rect,
      note: '',
      heightKey: 'H',
      fields: [
        { key: 'L', label: '长 L' },
        { key: 'W', label: '宽 W' },
        { key: 'H', label: '高 H' }
      ],
      defaults: { L: '400', W: '300', H: '300' },
      checks: function (values) {
        return positiveErrors(SHAPES.rect, values);
      },
      bbox: function (v) {
        return { l: toNum(v.L), w: toNum(v.W), h: toNum(v.H) };
      },
      volume: function (v) {
        var b = SHAPES.rect.bbox(v);
        return b.l * b.w * b.h;
      }
    },

    lshape: {
      key: 'lshape',
      name: 'L形箱',
      short: 'L形',
      tagline: 'W低 + W高 = W，H低 < H高',
      icon: ICONS.lshape,
      note: '截面沿长度方向不变：靠前一段深 W低、高 H低，靠后一段深 W高、高 H高。',
      heightKey: 'Hhigh',
      fields: [
        { key: 'L', label: '总长 L' },
        { key: 'W', label: '总深 W' },
        { key: 'Wlow', label: '低段深 W低' },
        { key: 'Whigh', label: '高段深 W高' },
        { key: 'Hlow', label: '低段高 H低' },
        { key: 'Hhigh', label: '高段高 H高' }
      ],
      defaults: { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' },
      checks: function (values) {
        var errs = positiveErrors(SHAPES.lshape, values);
        var bad = badSet(errs);
        var W = toNum(values.W);
        var Wlow = toNum(values.Wlow);
        var Whigh = toNum(values.Whigh);
        var Hlow = toNum(values.Hlow);
        var Hhigh = toNum(values.Hhigh);

        if (!bad.W && !bad.Wlow && !bad.Whigh) {
          var sum = Wlow + Whigh;
          if (Math.abs(sum - W) > EPS) {
            errs.push({
              field: 'W',
              message: 'W低 + W高 = ' + num(sum) + ' mm，与总深 W = ' + num(W) +
                ' mm 不一致（差 ' + num(Math.abs(sum - W)) + ' mm）。三者必须满足 W低 + W高 = W。'
            });
          }
        }
        if (!bad.Hlow && !bad.Hhigh && Hlow >= Hhigh) {
          errs.push({
            field: 'Hlow',
            message: 'H低 必须小于 H高（当前 H低 ' + num(Hlow) + ' mm，H高 ' + num(Hhigh) + ' mm）'
          });
        }
        return errs;
      },
      bbox: function (v) {
        return { l: toNum(v.L), w: toNum(v.W), h: toNum(v.Hhigh) };
      },
      volume: function (v) {
        var L = toNum(v.L);
        var Wlow = toNum(v.Wlow);
        var Whigh = toNum(v.Whigh);
        var Hlow = toNum(v.Hlow);
        var Hhigh = toNum(v.Hhigh);
        return L * (Wlow * Hlow + Whigh * Hhigh);
      }
    },

    slope: {
      key: 'slope',
      name: '斜顶箱',
      short: '斜顶',
      tagline: 'H底 < H高，顶面斜坡',
      icon: ICONS.slope,
      note: '顶面沿长度方向线性升高：前端高 H底，后端高 H高。',
      heightKey: 'Hhigh',
      fields: [
        { key: 'L', label: '总长 L' },
        { key: 'W', label: '总深 W' },
        { key: 'Hlow', label: '前端高 H底' },
        { key: 'Hhigh', label: '后端高 H高' }
      ],
      defaults: { L: '600', W: '400', Hlow: '300', Hhigh: '500' },
      checks: function (values) {
        var errs = positiveErrors(SHAPES.slope, values);
        var bad = badSet(errs);
        var Hlow = toNum(values.Hlow);
        var Hhigh = toNum(values.Hhigh);
        if (!bad.Hlow && !bad.Hhigh && Hlow >= Hhigh) {
          errs.push({
            field: 'Hlow',
            message: 'H底 必须小于 H高（当前 H底 ' + num(Hlow) + ' mm，H高 ' + num(Hhigh) + ' mm）'
          });
        }
        return errs;
      },
      bbox: function (v) {
        return { l: toNum(v.L), w: toNum(v.W), h: toNum(v.Hhigh) };
      },
      volume: function (v) {
        var L = toNum(v.L);
        var W = toNum(v.W);
        var Hlow = toNum(v.Hlow);
        var Hhigh = toNum(v.Hhigh);
        return L * W * (Hlow + Hhigh) / 2;
      }
    }
  };

  var ORDER = ['rect', 'lshape', 'slope'];

  NS.shapes = {
    EPS: EPS,
    list: SHAPES,
    order: ORDER,
    get: function (key) {
      return SHAPES[key] || SHAPES.rect;
    },
    toNum: toNum,
    num: num,
    /** 外接长方体体积（排布用），mm³ */
    bboxVolume: function (key, values) {
      var b = SHAPES[key].bbox(values);
      return b.l * b.w * b.h;
    },
    /** 净体积占比：净体积 / 外接体积，用于界面提示保守程度 */
    fillRatio: function (key, values) {
      var shape = SHAPES[key];
      var b = shape.bbox(values);
      var outer = b.l * b.w * b.h;
      if (!Number.isFinite(outer) || outer <= 0) return NaN;
      return shape.volume(values) / outer;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.shapes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
