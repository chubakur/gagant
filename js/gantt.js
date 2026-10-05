/*
 * gantt.js - отрисовка диаграммы Ганта в SVG.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var PALETTE = ['#4c8dff', '#7c5cff', '#2fbf71', '#ffb020', '#ff5c6c', '#28c2d1', '#e05fb0', '#8bd450', '#f28e2b', '#59a14f'];
  var LABEL_W = 250;
  var DAY_W = 26;
  var ROW_H = 34;
  var HEAD_H = 48;
  var BAR_H = 18;

  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function colorFor(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

  function monthName(d) {
    var m = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return m[d.getMonth()];
  }

  function render(container, project, result, opts) {
    opts = opts || {};
    container.innerHTML = '';
    if (!result || !result.days.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = project && project.tasks.length
        ? 'Нет данных для отображения'
        : 'Добавьте команды и задачи, чтобы построить диаграмму Ганта.';
      container.appendChild(empty);
      return;
    }

    var teamIndex = {};
    (project.teams || []).forEach(function (t, i) { teamIndex[t.id] = i; });

    var rows = (project.tasks || []).slice().sort(function (a, b) {
      var ra = result.tasks[a.id], rb = result.tasks[b.id];
      if (!ra || !rb) return 0;
      if (ra.startIdx !== rb.startIdx) return ra.startIdx - rb.startIdx;
      if (ra.endIdx !== rb.endIdx) return ra.endIdx - rb.endIdx;
      return String(a.title).localeCompare(String(b.title));
    });

    var nDays = result.days.length;
    var width = LABEL_W + nDays * DAY_W + 2;
    var height = HEAD_H + rows.length * ROW_H + 8;

    var svg = el('svg', { 'class': 'gantt', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height });
    var defs = el('defs');
    var marker = el('marker', { id: 'arrow', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
    marker.appendChild(el('path', { d: 'M0,0 L8,4 L0,8 z', fill: '#5b6b8c' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    var rowY = {};
    rows.forEach(function (t, i) { rowY[t.id] = HEAD_H + i * ROW_H; });

    // --- колонки дней: заливка выходных + сетка + подписи
    var lastMonth = -1;
    for (var i = 0; i < nDays; i++) {
      var d = result.days[i];
      var x = LABEL_W + i * DAY_W;
      if (Scheduler.isWeekend(d) && !project.skipWeekends) {
        svg.appendChild(el('rect', { 'class': 'grid weekend', x: x, y: HEAD_H, width: DAY_W, height: height - HEAD_H }));
      }
      svg.appendChild(el('line', { 'class': 'grid', x1: x, y1: HEAD_H, x2: x, y2: height }));
      // подпись дня
      var dayLabel = el('text', { 'class': 'axis-text', x: x + DAY_W / 2, y: HEAD_H - 22, 'text-anchor': 'middle' });
      dayLabel.textContent = String(d.getDate());
      svg.appendChild(dayLabel);
      if (d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth();
        svg.appendChild(el('line', { 'class': 'grid', x1: x, y1: 0, x2: x, y2: height, stroke: '#3a4c72' }));
        var mt = el('text', { 'class': 'axis-text', x: x + 3, y: HEAD_H - 34, 'text-anchor': 'start', fill: '#c7d2e6' });
        mt.textContent = monthName(d);
        svg.appendChild(mt);
      }
    }
    svg.appendChild(el('line', { 'class': 'grid', x1: LABEL_W + nDays * DAY_W, y1: HEAD_H, x2: LABEL_W + nDays * DAY_W, y2: height }));

    // --- сегодня
    var todayStr = Scheduler.fmtDate(new Date());
    for (var ti = 0; ti < nDays; ti++) {
      if (Scheduler.fmtDate(result.days[ti]) === todayStr) {
        var tx = LABEL_W + ti * DAY_W + DAY_W / 2;
        svg.appendChild(el('line', { 'class': 'today', x1: tx, y1: HEAD_H, x2: tx, y2: height }));
        break;
      }
    }

    // --- строки задач и бары
    rows.forEach(function (t) {
      var r = result.tasks[t.id];
      var y0 = rowY[t.id];
      svg.appendChild(el('line', { 'class': 'rowline', x1: 0, y1: y0, x2: width, y2: y0 }));

      var title = el('text', { 'class': 'label', x: 12, y: y0 + 15 });
      title.textContent = t.title || '(без названия)';
      svg.appendChild(title);

      var cap = 40;
      var sub = el('text', { 'class': 'label-sub', x: 12, y: y0 + 28 });
      var teamLabel = Store.teamName(t.teamId) || '—';
      var durTxt = r ? (r.workDays + ' дн.') : '';
      sub.textContent = teamLabel + ' · ' + (t.estimate || 0) + ' ед. · ' + durTxt;
      svg.appendChild(sub);

      if (!r) return;
      var barY = y0 + (ROW_H - BAR_H) / 2 - 1;
      var bx = LABEL_W + r.startIdx * DAY_W + 2;
      var bw = Math.max(6, (r.endIdx - r.startIdx) * DAY_W - 4);
      var color = colorFor(teamIndex[t.teamId] === undefined ? 0 : teamIndex[t.teamId]);
      var bar = el('rect', {
        'class': 'bar', x: bx, y: barY, width: bw, height: BAR_H, rx: 4, fill: color,
        'data-task': t.id, tabindex: '0'
      });
      var tt = el('title');
      tt.textContent = (t.title || '') + '\n' + teamLabel + ' · ' + (t.estimate || 0) + ' ед.\n' +
        Scheduler.fmtDate(r.startDate) + ' → ' + Scheduler.fmtDate(r.endDate);
      bar.appendChild(tt);
      if (opts.onTaskClick) {
        bar.addEventListener('click', function () { opts.onTaskClick(t.id); });
      }
      svg.appendChild(bar);

      if (bw > 46) {
        var bt = el('text', { 'class': 'bar-text', x: bx + 6, y: barY + BAR_H / 2 + 3 });
        bt.textContent = Math.round(r.workDays * 10) / 10 + ' дн';
        svg.appendChild(bt);
      }
    });

    // --- стрелки зависимостей
    rows.forEach(function (t) {
      var dep = t.dependencies || [];
      if (!dep.length) return;
      var r = result.tasks[t.id];
      if (!r) return;
      var y2 = rowY[t.id] + ROW_H / 2;
      dep.forEach(function (id) {
        var rd = result.tasks[id];
        if (!rd) return;
        var x1 = LABEL_W + rd.endIdx * DAY_W;
        var y1 = rowY[id] + ROW_H / 2;
        var x2 = LABEL_W + r.startIdx * DAY_W;
        var mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
        if (x2 - x1 < 16) mid = x1 + 6;
        var d = 'M' + x1 + ',' + y1 + ' H' + mid + ' V' + y2 + ' H' + (x2 - 6);
        svg.appendChild(el('path', { 'class': 'dep', d: d }));
      });
    });

    container.appendChild(svg);
  }

  global.Gantt = { render: render, colorFor: colorFor };
})(window);
