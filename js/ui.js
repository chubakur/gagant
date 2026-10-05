/*
 * ui.js - связывание состояния (Store) с интерфейсом и диаграммой.
 */
(function (global) {
  'use strict';

  var S = global.Store;
  var $ = function (id) { return document.getElementById(id); };
  var editingTaskId = null;
  var editingTeamId = null;
  var lastResult = null;

  function fmtHuman(d) {
    if (!d) return '—';
    var m = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
  }

  function computeSchedule() {
    var p = S.current();
    if (!p) return null;
    try {
      var res = global.Scheduler.schedule(p, { startDate: p.startDate, skipWeekends: p.skipWeekends });
      hideErrors();
      return res;
    } catch (e) {
      showErrors(e.message || String(e));
      return null;
    }
  }

  function showErrors(msg) { var el = $('errors'); el.hidden = false; el.textContent = msg; }
  function hideErrors() { var el = $('errors'); el.hidden = true; el.textContent = ''; }

  function renderProjectSelect() {
    var sel = $('projectSelect');
    sel.innerHTML = '';
    S.get().projects.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      if (p.id === S.get().currentProjectId) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderTeams() {
    var p = S.current();
    var ul = $('teamList');
    ul.innerHTML = '';
    if (!p || !p.teams.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Нет команд. Добавьте команду.';
      ul.appendChild(li);
      return;
    }
    p.teams.forEach(function (tm, i) {
      var li = document.createElement('li');
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = global.Gantt.colorFor(i);
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = tm.name;
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = tm.capacity + ' ед/дн';
      li.appendChild(dot); li.appendChild(name); li.appendChild(meta);
      li.addEventListener('click', function () { openTeamDialog(tm.id); });
      ul.appendChild(li);
    });
  }

  function renderTasks() {
    var p = S.current();
    var ul = $('taskList');
    ul.innerHTML = '';
    if (!p || !p.tasks.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Нет задач. Добавьте задачу.';
      ul.appendChild(li);
      return;
    }
    var teamIndex = {};
    (p.teams || []).forEach(function (t, i) { teamIndex[t.id] = i; });
    var ordered = p.tasks.slice().sort(function (a, b) {
      var ra = lastResult && lastResult.tasks[a.id], rb = lastResult && lastResult.tasks[b.id];
      if (ra && rb && ra.startIdx !== rb.startIdx) return ra.startIdx - rb.startIdx;
      return String(a.title).localeCompare(String(b.title));
    });
    ordered.forEach(function (t) {
      var li = document.createElement('li');
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = global.Gantt.colorFor(teamIndex[t.teamId] || 0);
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.title;
      var meta = document.createElement('span');
      meta.className = 'meta';
      var r = lastResult && lastResult.tasks[t.id];
      meta.textContent = r ? (global.Scheduler.fmtDate(r.startDate).slice(5) + '→' + global.Scheduler.fmtDate(r.endDate).slice(5)) : '';
      li.appendChild(dot); li.appendChild(name); li.appendChild(meta);
      li.addEventListener('click', function () { openTaskDialog(t.id); });
      ul.appendChild(li);
    });
  }

  function renderSummary(p, res) {
    var box = $('summary');
    box.innerHTML = '';
    if (!p) return;
    var totalEst = p.tasks.reduce(function (a, t) { return a + (Number(t.estimate) || 0); }, 0);
    var items = [
      ['Задач', p.tasks.length],
      ['Команд', p.teams.length],
      ['Суммарная оценка', totalEst + ' ед.'],
      ['Старт', p.startDate ? fmtHuman(global.Scheduler.parseDate(p.startDate)) : '—'],
      ['Финиш', res ? fmtHuman(res.finishDate) : '—'],
      ['Длительность', res ? res.days.length + ' раб. дн.' : '—']
    ];
    items.forEach(function (it) {
      var s = document.createElement('span');
      s.innerHTML = it[0] + ': <b></b>';
      s.querySelector('b').textContent = String(it[1]);
      box.appendChild(s);
    });
  }

  function renderLegend(p) {
    var box = $('legend');
    box.innerHTML = '';
    if (!p) return;
    (p.teams || []).forEach(function (tm, i) {
      var d = document.createElement('span');
      d.className = 'item';
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = global.Gantt.colorFor(i);
      var s = document.createElement('span');
      s.textContent = tm.name + ' (' + tm.capacity + ' ед/дн)';
      d.appendChild(dot); d.appendChild(s);
      box.appendChild(d);
    });
  }

  function rerender() {
    var p = S.current();
    // верхняя панель
    renderProjectSelect();
    if ($('startDate').value !== (p ? p.startDate : '')) $('startDate').value = p ? p.startDate : '';
    $('skipWeekends').checked = p ? !!p.skipWeekends : false;
    $('startDate').disabled = $('skipWeekends').disabled = !p;

    lastResult = computeSchedule();
    renderTeams();
    renderTasks();
    renderSummary(p, lastResult);
    renderLegend(p);
    global.Gantt.render($('ganttWrap'), p, lastResult, { onTaskClick: openTaskDialog });
    if (editingTaskId || editingTeamId) { /* диалог обновлять не нужно */ }
  }

  // ---------- Диалог задачи ----------
  function openTaskDialog(taskId) {
    var p = S.current();
    if (!p) return;
    if (!p.teams.length) { alert('Сначала добавьте хотя бы одну команду.'); return; }
    editingTaskId = taskId || null;
    var t = taskId ? p.tasks.filter(function (x) { return x.id === taskId; })[0] : null;
    $('taskDialogTitle').textContent = t ? 'Задача' : 'Новая задача';
    $('taskTitle').value = t ? t.title : '';
    $('taskEstimate').value = t ? t.estimate : 8;
    $('taskMinStart').value = t ? (t.minStart || '') : '';
    $('taskDescription').value = t ? (t.description || '') : '';

    var teamSel = $('taskTeam');
    teamSel.innerHTML = '';
    p.teams.forEach(function (tm) {
      var o = document.createElement('option');
      o.value = tm.id; o.textContent = tm.name;
      if (t && t.teamId === tm.id) o.selected = true;
      teamSel.appendChild(o);
    });

    var depsBox = $('taskDeps');
    depsBox.innerHTML = '';
    var candidates = p.tasks.filter(function (x) { return x.id !== (t ? t.id : null); });
    if (!candidates.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Других задач пока нет.';
      depsBox.appendChild(e);
    }
    candidates.forEach(function (c) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = c.id;
      if (t && (t.dependencies || []).indexOf(c.id) >= 0) cb.checked = true;
      var span = document.createElement('span');
      span.textContent = c.title;
      var tm = document.createElement('span');
      tm.className = 'depteam';
      tm.textContent = '(' + (S.teamName(c.teamId) || '—') + ')';
      lab.appendChild(cb); lab.appendChild(span); lab.appendChild(tm);
      depsBox.appendChild(lab);
    });

    $('taskDelete').style.display = t ? '' : 'none';
    $('taskDialog').showModal();
  }

  function saveTask() {
    var p = S.current();
    if (!p) return;
    var title = $('taskTitle').value.trim();
    if (!title) { alert('Введите название задачи.'); return; }
    var teamId = $('taskTeam').value;
    if (!teamId) { alert('Выберите команду.'); return; }
    var estimate = Math.max(0, parseInt($('taskEstimate').value, 10) || 0);
    var minStart = $('taskMinStart').value || '';
    var description = $('taskDescription').value;
    var deps = [];
    Array.prototype.forEach.call($('taskDeps').querySelectorAll('input[type=checkbox]'), function (cb) {
      if (cb.checked) deps.push(cb.value);
    });
    if (deps.indexOf(editingTaskId) >= 0) deps = deps.filter(function (d) { return d !== editingTaskId; });

    if (editingTaskId) {
      S.updateTask(editingTaskId, { title: title, teamId: teamId, estimate: estimate, minStart: minStart, description: description, dependencies: deps });
    } else {
      S.addTask({ title: title, teamId: teamId, estimate: estimate, minStart: minStart, description: description, dependencies: deps });
    }
    $('taskDialog').close();
  }

  function deleteTask() {
    if (!editingTaskId) return;
    if (!confirm('Удалить задачу?')) return;
    S.deleteTask(editingTaskId);
    $('taskDialog').close();
  }

  // ---------- Диалог команды ----------
  function openTeamDialog(teamId) {
    var p = S.current();
    if (!p) return;
    editingTeamId = teamId || null;
    var tm = teamId ? p.teams.filter(function (x) { return x.id === teamId; })[0] : null;
    $('teamDialogTitle').textContent = tm ? 'Команда' : 'Новая команда';
    $('teamName').value = tm ? tm.name : 'Команда ' + (p.teams.length + 1);
    $('teamCapacity').value = tm ? tm.capacity : 1;
    $('teamDelete').style.display = tm ? '' : 'none';
    $('teamDialog').showModal();
  }

  function saveTeam() {
    var name = $('teamName').value.trim();
    if (!name) { alert('Введите название команды.'); return; }
    var capacity = Math.max(1, parseInt($('teamCapacity').value, 10) || 1);
    if (editingTeamId) S.updateTeam(editingTeamId, { name: name, capacity: capacity });
    else S.addTeam(name, capacity);
    $('teamDialog').close();
  }

  function deleteTeam() {
    if (!editingTeamId) return;
    var res = S.deleteTeam(editingTeamId);
    if (!res.ok) { alert(res.reason); return; }
    $('teamDialog').close();
  }

  // ---------- Экспорт / импорт ----------
  function doExport() {
    var blob = new Blob([S.exportJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gagant-' + global.Scheduler.fmtDate(new Date()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function doImportFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        S.importJson(String(reader.result), 'merge');
        alert('Данные импортированы (проекты добавлены).');
      } catch (e) {
        alert('Ошибка импорта: ' + (e.message || e));
      }
    };
    reader.readAsText(file);
  }

  // ---------- Инициализация ----------
  function init() {
    $('projectSelect').addEventListener('change', function () { S.setCurrent(this.value); });
    $('newProjectBtn').addEventListener('click', function () {
      var name = prompt('Название проекта:', 'Новый проект');
      if (name) S.addProject(name.trim() || 'Новый проект');
    });
    $('renameProjectBtn').addEventListener('click', function () {
      var p = S.current(); if (!p) return;
      var name = prompt('Новое название проекта:', p.name);
      if (name) S.updateProject({ name: name.trim() || p.name });
    });
    $('deleteProjectBtn').addEventListener('click', function () {
      var p = S.current(); if (!p) return;
      if (confirm('Удалить проект «' + p.name + '»?')) S.deleteProject();
    });
    $('startDate').addEventListener('change', function () { S.updateProject({ startDate: this.value }); });
    $('skipWeekends').addEventListener('change', function () { S.updateProject({ skipWeekends: this.checked }); });

    $('addTeamBtn').addEventListener('click', function () { openTeamDialog(null); });
    $('addTaskBtn').addEventListener('click', function () { openTaskDialog(null); });

    $('teamSave').addEventListener('click', saveTeam);
    $('teamDelete').addEventListener('click', deleteTeam);
    $('teamCancel').addEventListener('click', function () { $('teamDialog').close(); });

    $('taskSave').addEventListener('click', saveTask);
    $('taskDelete').addEventListener('click', deleteTask);
    $('taskCancel').addEventListener('click', function () { $('taskDialog').close(); });

    $('exportBtn').addEventListener('click', doExport);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
      if (this.files && this.files[0]) doImportFile(this.files[0]);
      this.value = '';
    });

    // клавиатура: Enter в формах
    $('teamForm').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveTeam(); }
    });

    S.onChange(rerender);
    rerender();
  }

  global.Ui = { init: init, rerender: rerender };
})(window);
