/*
 * 导出下载：把 report.buildCsv 生成的文本存成文件。
 * 单独一层，方便以后加 XLSX 导出。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});

  function download(text, filename) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  NS.exportCsv = {
    download: download,
    /** 组合：生成并下载 */
    save: function (pack, state, extra) {
      var now = new Date();
      var text = NS.report.buildCsv(pack, state, { extra: extra, now: now });
      download(text, NS.report.suggestName(pack, now));
      return text;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
