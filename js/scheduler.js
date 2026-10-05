/*
 * scheduler.js - расчёт расписания (диаграммы Ганта).
 * Frontend-only: чистая функция schedule(project, opts) -> расписание.
 *
 * Модель:
 *   project.teams: [{id, name, capacity}]  capacity = единиц работы в день
 *   project.tasks: [{id, teamId, title, estimate, dependencies:[id], minStart}]
 *
 * Алгоритм (жадное планирование по дням с учётом ресурсов):
 *   1. Проверка зависимостей и топологическая сортировка (детект циклов).
 *   2. Приоритет = "upward rank" (длина пути до конца проекта), задачи
 *      критического пути получают ёмкость команды первыми.
 *   3. По дням: внутри каждой команды дневная ёмкость делится между готовыми
 *      задачами (зависимости выполнены, minStart наступил). Так получается
 *      параллельная работа в пределах ёмкости команды.
 *   4. Задача занимает рабочие дни [startIdx, endIdx).
 */
(function (global) {
  'use strict';

  var MS_DAY = 86400000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parseDate(s) {
    if (!s) return null;
    var p = String(s).split('-');
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function isWeekend(d) {
    var w = d.getDay();
    return w === 0 || w === 6;
  }

  function dayDiff(a, b) { return Math.round((b - a) / MS_DAY); }

  // Календарь рабочих дней: ленивое расширение массива дат.
  function createCalendar(startStr, skipWeekends) {
    var days = [];
    var cursor = parseDate(startStr) || new Date();
    cursor.setHours(0, 0, 0, 0);
    function ensure(i) {
      while (days.length <= i) {
        if (!(skipWeekends && isWeekend(cursor))) days.push(new Date(cursor.getTime()));
        cursor = addDays(cursor, 1);
      }
    }
    ensure(0);
    return {
      at: function (i) { ensure(i); return days[i]; },
      indexForDate: function (dateStr) {
        var target = parseDate(dateStr);
        if (!target) return 0;
        target.setHours(0, 0, 0, 0);
        if (target.getTime() <= days[0].getTime()) return 0;
        var i = 0;
        while (true) {
          ensure(i);
          if (days[i].getTime() >= target.getTime()) return i;
          i++;
        }
      }
    };
  }

  function topoSort(tasks) {
    var byId = {};
    tasks.forEach(function (t) { byId[t.id] = t; });
    var indeg = {}, succ = {};
    tasks.forEach(function (t) { indeg[t.id] = 0; succ[t.id] = []; });
    tasks.forEach(function (t) {
      (t.dependencies || []).forEach(function (d) {
        if (!byId[d]) return;
        indeg[t.id]++;
        succ[d].push(t.id);
      });
    });
    var queue = tasks.filter(function (t) { return indeg[t.id] === 0; })
      .map(function (t) { return t.id; });
    var order = [];
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      succ[id].forEach(function (s) {
        indeg[s]--;
        if (indeg[s] === 0) queue.push(s);
      });
    }
    if (order.length !== tasks.length) {
      var cycle = tasks.filter(function (t) { return order.indexOf(t.id) < 0; })
        .map(function (t) { return t.title || t.id; });
      throw new Error('Циклическая зависимость задач: ' + cycle.join(', '));
    }
    return order;
  }

  function computeRanks(tasks, byId, teamCap) {
    var succ = {};
    tasks.forEach(function (t) { succ[t.id] = []; });
    tasks.forEach(function (t) {
      (t.dependencies || []).forEach(function (d) {
        if (succ[d]) succ[d].push(t.id);
      });
    });
    var memo = {};
    function rank(id) {
      if (memo[id] !== undefined) return memo[id];
      memo[id] = 0;
      var t = byId[id];
      var cap = teamCap[t.teamId] || 1;
      var dur = (Number(t.estimate) || 0) / Math.max(1, cap);
      var best = 0;
      succ[id].forEach(function (s) { best = Math.max(best, rank(s)); });
      memo[id] = dur + best;
      return memo[id];
    }
    tasks.forEach(function (t) { rank(t.id); });
    return memo;
  }

  function schedule(project, opts) {
    opts = opts || {};
    var skipWeekends = opts.skipWeekends !== false;
    var startStr = opts.startDate || project.startDate || fmtDate(new Date());
    var tasks = (project.tasks || []).slice();
    var teams = project.teams || [];
    var byId = {};
    tasks.forEach(function (t) { byId[t.id] = t; });
    var teamCap = {};
    teams.forEach(function (t) { teamCap[t.id] = Math.max(1, Number(t.capacity) || 1); });

    tasks.forEach(function (t) {
      (t.dependencies || []).forEach(function (d) {
        if (!byId[d]) throw new Error('Задача «' + (t.title || t.id) + '» ссылается на несуществующую зависимость');
      });
    });
    tasks.forEach(function (t) {
      if (!teamCap[t.teamId]) throw new Error('У задачи «' + (t.title || t.id) + '» не задана существующая команда');
    });

    var order = topoSort(tasks);
    var rank = computeRanks(tasks, byId, teamCap);
    var cal = createCalendar(startStr, skipWeekends);

    var remaining = {}, startIdx = {}, endIdx = {}, minIdx = {};
    tasks.forEach(function (t) {
      remaining[t.id] = Math.max(0, Number(t.estimate) || 0);
      minIdx[t.id] = t.minStart ? cal.indexForDate(t.minStart) : 0;
    });

    function depsDone(id, day) {
      var deps = byId[id].dependencies || [];
      for (var i = 0; i < deps.length; i++) {
        var d = deps[i];
        if (endIdx[d] === undefined || endIdx[d] > day) return false;
      }
      return true;
    }

    var doneCount = 0, day = 0, guard = 0;
    while (doneCount < tasks.length && guard < 200000) {
      guard++;
      var byTeam = {};
      order.forEach(function (id) {
        if (endIdx[id] !== undefined) return;
        var t = byId[id];
        if (startIdx[id] === undefined) {
          if (minIdx[id] > day) return;
          if (!depsDone(id, day)) return;
        }
        (byTeam[t.teamId] = byTeam[t.teamId] || []).push(id);
      });

      Object.keys(byTeam).forEach(function (teamId) {
        var ids = byTeam[teamId];
        var cap = teamCap[teamId] || 1;
        ids.sort(function (a, b) {
          var d = rank[b] - rank[a];
          if (d !== 0) return d;
          var sa = startIdx[a] !== undefined ? 1 : 0, sb = startIdx[b] !== undefined ? 1 : 0;
          if (sa !== sb) return sb - sa;
          return remaining[b] - remaining[a];
        });

        var work = [];
        ids.forEach(function (id) {
          if (remaining[id] <= 0) {
            if (startIdx[id] === undefined) startIdx[id] = day;
            endIdx[id] = day;
            doneCount++;
          } else {
            work.push(id);
          }
        });
        if (!work.length) return;

        var n = work.length;
        var share = Math.floor(cap / n);
        var alloc = {}, leftover = cap;
        work.forEach(function (id) {
          var a = Math.min(remaining[id], share);
          alloc[id] = a;
          leftover -= a;
        });
        for (var i = 0; i < work.length && leftover > 0; i++) {
          var id2 = work[i];
          var add = Math.min(remaining[id2] - alloc[id2], leftover);
          alloc[id2] += add;
          leftover -= add;
        }
        work.forEach(function (id) {
          var a = alloc[id];
          if (a <= 0) return;
          if (startIdx[id] === undefined) startIdx[id] = day;
          remaining[id] -= a;
          if (remaining[id] <= 0) { endIdx[id] = day + 1; doneCount++; }
        });
      });
      day++;
    }
    if (guard >= 200000) throw new Error('Не удалось построить расписание: слишком большой горизонт');

    var maxEnd = 0;
    tasks.forEach(function (t) { maxEnd = Math.max(maxEnd, endIdx[t.id]); });
    var days = [];
    for (var i = 0; i < maxEnd; i++) days.push(cal.at(i));

    var map = {};
    tasks.forEach(function (t) {
      var si = startIdx[t.id], ei = endIdx[t.id];
      map[t.id] = {
        startIdx: si,
        endIdx: ei,
        startDate: cal.at(si),
        endDate: cal.at(ei > si ? ei - 1 : si),
        workDays: Math.max(0, ei - si)
      };
    });

    return {
      days: days,
      maxEnd: maxEnd,
      tasks: map,
      startDate: parseDate(startStr),
      finishDate: maxEnd > 0 ? cal.at(maxEnd - 1) : (parseDate(startStr) || new Date())
    };
  }

  global.Scheduler = {
    schedule: schedule,
    fmtDate: fmtDate,
    parseDate: parseDate,
    addDays: addDays,
    dayDiff: dayDiff,
    isWeekend: isWeekend
  };
})(window);
