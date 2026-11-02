/*
 * 集装箱规格面板：预设切换、参数可编辑、恢复默认。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  var C = NS.containers;
  var V = NS.validate;

  var FIELD_IDS = {
    innerL: 'spec-innerL',
    innerW: 'spec-innerW',
    innerH: 'spec-innerH',
    doorH: 'spec-doorH',
    payload: 'spec-payload'
  };

  function mount(state, opts) {
    var onChange = opts.onChange || function () {};
    var presetRow = document.getElementById('preset-row');
    var noteEl = document.getElementById('spec-note');
    var resetBtn = document.getElementById('reset-container');
    var inputs = {};
    Object.keys(FIELD_IDS).forEach(function (k) {
      inputs[k] = document.getElementById(FIELD_IDS[k]);
    });

    function num(v) { return NS.shapes.num(NS.shapes.toNum(v)); }

    function renderPresets() {
      presetRow.innerHTML = '';
      C.presets.forEach(function (p) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preset';
        btn.setAttribute('role', 'tab');
        btn.dataset.key = p.key;
        btn.innerHTML = '<b>' + p.label + '</b><span>内 ' + p.innerL + '×' + p.innerW + '×' + p.innerH + '</span>';
        btn.addEventListener('click', function () {
          state.container = C.get(p.key);
          renderAll();
          onChange();
          paintErrors(true);
        });
        presetRow.appendChild(btn);
      });
      updateActive();
    }

    function updateActive() {
      var c = state.container;
      var active = null;
      if (!C.isCustom(c)) active = c.key;
      Array.prototype.forEach.call(presetRow.children, function (b) {
        var on = b.dataset.key === active;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var p = null;
      C.presets.forEach(function (x) { if (x.key === c.key) p = x; });
      if (C.isCustom(c)) {
        noteEl.innerHTML = '已自定义参数：内 ' + num(c.innerL) + '×' + num(c.innerW) + '×' + num(c.innerH) +
          ' mm · 门高 ' + num(c.doorH) + ' mm · 载重 ' + num(c.payload) + ' kg';
        noteEl.classList.add('custom');
      } else {
        noteEl.innerHTML = (p ? p.label : '') + ' 默认：内 ' + num(c.innerL) + '×' + num(c.innerW) + '×' + num(c.innerH) +
          ' mm · 门高 ' + num(c.doorH) + ' mm · 载重 ' + num(c.payload) + ' kg';
        noteEl.classList.remove('custom');
      }
    }

    function renderInputs() {
      Object.keys(FIELD_IDS).forEach(function (k) {
        inputs[k].value = state.container[k] === null || state.container[k] === undefined ? '' : state.container[k];
      });
    }

    function renderAll() {
      renderInputs();
      updateActive();
    }

    function paintErrors(reset) {
      Object.keys(FIELD_IDS).forEach(function (k) {
        inputs[k].classList.remove('invalid');
        inputs[k].removeAttribute('aria-invalid');
      });
      if (!reset) {
        V.containerErrors(state.container).forEach(function (e) {
          if (e.level !== 'error' || !inputs[e.field]) return;
          inputs[e.field].classList.add('invalid');
          inputs[e.field].setAttribute('aria-invalid', 'true');
        });
      }
    }

    Object.keys(FIELD_IDS).forEach(function (k) {
      inputs[k].addEventListener('input', function () {
        state.container[k] = inputs[k].value;
        updateActive();
        onChange();
      });
    });

    resetBtn.addEventListener('click', function () {
      state.container = C.get(state.container.key);
      renderAll();
      onChange();
      paintErrors(true);
    });

    renderPresets();
    renderAll();

    return {
      render: renderAll,
      paintErrors: paintErrors
    };
  }

  NS.ui = NS.ui || {};
  NS.ui.containerPanel = { mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
