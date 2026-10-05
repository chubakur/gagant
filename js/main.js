/* main.js - точка входа */
(function () {
  'use strict';
  function boot() {
    try {
      window.Ui.init();
    } catch (e) {
      var box = document.getElementById('errors');
      if (box) { box.hidden = false; box.textContent = 'Ошибка инициализации: ' + (e.message || e); }
      console.error(e);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
