/*
 * store.js - состояние приложения, localStorage, экспорт/импорт JSON.
 */
(function (global) {
  'use strict';

  var KEY = 'gagant.state.v1';
  var state = null;
  var listeners = [];

  function uid() {
    return 'id' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function todayStr() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function blankState() {
    return { version: 1, projects: [], currentProjectId: null };
  }

  function demoState() {
    var p = {
      id: uid(), name: 'Демо-проект', description: 'Пример: команды, оценки и зависимости.',
      startDate: todayStr(), skipWeekends: true, teams: [], tasks: []
    };
    var be = { id: uid(), name: 'Backend', capacity: 2 };
    var fe = { id: uid(), name: 'Frontend', capacity: 2 };
    var qa = { id: uid(), name: 'QA', capacity: 1 };
    p.teams = [be, fe, qa];
    function mk(title, team, est, deps) {
      return { id: uid(), teamId: team, title: title, description: '', estimate: est, dependencies: deps || [], minStart: '' };
    }
    var api = mk('Проектирование API', be.id, 6);
    var model = mk('Модель данных', be.id, 8);
    var screen = mk('Экран ганта', fe.id, 10, [api.id]);
    var forms = mk('Формы задач', fe.id, 6, [model.id]);
    var integ = mk('Интеграция', fe.id, 8, [screen.id, forms.id]);
    var testApi = mk('Тесты API', qa.id, 6, [api.id, model.id]);
    var e2e = mk('E2E тесты', qa.id, 8, [integ.id]);
    p.tasks = [api, model, screen, forms, integ, testApi, e2e];
    var st = blankState();
    st.projects = [p];
    st.currentProjectId = p.id;
    return st;
  }

  function normalize(st) {
    if (!st || typeof st !== 'object') return demoState();
    if (!Array.isArray(st.projects)) st.projects = [];
    st.projects.forEach(function (p) {
      if (!Array.isArray(p.teams)) p.teams = [];
      if (!Array.isArray(p.tasks)) p.tasks = [];
      if (!p.startDate) p.startDate = todayStr();
      if (typeof p.skipWeekends !== 'boolean') p.skipWeekends = true;
      p.tasks.forEach(function (t) {
        if (!Array.isArray(t.dependencies)) t.dependencies = [];
        if (typeof t.estimate !== 'number') t.estimate = Number(t.estimate) || 0;
        if (!t.minStart) t.minStart = '';
      });
      p.teams.forEach(function (tm) {
        if (typeof tm.capacity !== 'number') tm.capacity = Math.max(1, Number(tm.capacity) || 1);
      });
    });
    if (!st.projects.length) return demoState();
    if (!st.projects.some(function (p) { return p.id === st.currentProjectId; })) {
      st.currentProjectId = st.projects[0].id;
    }
    return st;
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return demoState();
  }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota */ }
  }

  function notify() {
    save();
    listeners.forEach(function (fn) { fn(state); });
  }

  function onChange(fn) { listeners.push(fn); }

  function get() { return state; }

  function current() {
    if (!state) return null;
    return state.projects.filter(function (p) { return p.id === state.currentProjectId; })[0] || null;
  }

  function setCurrent(id) { state.currentProjectId = id; notify(); }

  function addProject(name) {
    var p = { id: uid(), name: name || 'Новый проект', description: '', startDate: todayStr(), skipWeekends: true, teams: [], tasks: [] };
    state.projects.push(p);
    state.currentProjectId = p.id;
    notify();
    return p;
  }

  function updateProject(patch) {
    var p = current();
    if (!p) return;
    Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
    notify();
  }

  function deleteProject() {
    var id = state.currentProjectId;
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    if (!state.projects.length) state.projects = [blankProject()];
    state.currentProjectId = state.projects[0].id;
    notify();
  }

  function blankProject() {
    return { id: uid(), name: 'Новый проект', description: '', startDate: todayStr(), skipWeekends: true, teams: [], tasks: [] };
  }

  function addTeam(name, capacity) {
    var p = current();
    if (!p) return;
    var tm = { id: uid(), name: name || 'Команда', capacity: Math.max(1, Number(capacity) || 1) };
    p.teams.push(tm);
    notify();
    return tm;
  }

  function updateTeam(id, patch) {
    var p = current();
    if (!p) return;
    var tm = p.teams.filter(function (t) { return t.id === id; })[0];
    if (!tm) return;
    Object.keys(patch).forEach(function (k) { tm[k] = patch[k]; });
    notify();
  }

  function deleteTeam(id) {
    var p = current();
    if (!p) return { ok: false, reason: 'На эту команду назначены задачи' };
    var used = p.tasks.some(function (t) { return t.teamId === id; });
    if (used) return { ok: false, reason: 'Нельзя удалить команду, на которую назначены задачи' };
    p.teams = p.teams.filter(function (t) { return t.id !== id; });
    notify();
    return { ok: true };
  }

  function addTask(data) {
    var p = current();
    if (!p) return;
    var t = {
      id: uid(),
      teamId: data.teamId,
      title: data.title || 'Задача',
      description: data.description || '',
      estimate: Number(data.estimate) || 0,
      dependencies: data.dependencies || [],
      minStart: data.minStart || ''
    };
    p.tasks.push(t);
    notify();
    return t;
  }

  function updateTask(id, patch) {
    var p = current();
    if (!p) return;
    var t = p.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    notify();
  }

  function deleteTask(id) {
    var p = current();
    if (!p) return;
    p.tasks = p.tasks.filter(function (t) { return t.id !== id; });
    p.tasks.forEach(function (t) {
      t.dependencies = (t.dependencies || []).filter(function (d) { return d !== id; });
    });
    notify();
  }

  function teamName(id) {
    var p = current();
    if (!p) return '';
    var tm = p.teams.filter(function (t) { return t.id === id; })[0];
    return tm ? tm.name : '';
  }

  function exportJson() {
    return JSON.stringify({ gagant: 1, exportedAt: new Date().toISOString(), state: state }, null, 2);
  }

  function importJson(text, mode) {
    var parsed = JSON.parse(text);
    var incoming = parsed && parsed.state ? parsed.state : parsed;
    if (!incoming || !Array.isArray(incoming.projects)) throw new Error('Некорректный файл: нет списка проектов');
    incoming = normalize(JSON.parse(JSON.stringify(incoming)));
    if (mode === 'replace') {
      state = incoming;
    } else {
      // merge: добавляем проекты с уникальными именами
      incoming.projects.forEach(function (p) {
        if (state.projects.some(function (x) { return x.id === p.id; })) p.id = uid();
        p.tasks.forEach(function (t) { t.id = t.id || uid(); });
        state.projects.push(p);
      });
      state.currentProjectId = incoming.projects[0].id;
    }
    notify();
  }

  state = load();

  global.Store = {
    get: get,
    current: current,
    setCurrent: setCurrent,
    addProject: addProject,
    updateProject: updateProject,
    deleteProject: deleteProject,
    addTeam: addTeam,
    updateTeam: updateTeam,
    deleteTeam: deleteTeam,
    addTask: addTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    teamName: teamName,
    exportJson: exportJson,
    importJson: importJson,
    onChange: onChange,
    uid: uid,
    todayStr: todayStr
  };
})(window);
