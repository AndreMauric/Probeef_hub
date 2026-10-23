// Tema claro/escuro. Carregado no <head> (sem "defer") para aplicar o tema salvo antes da página
// aparecer, sem piscar. Sem escolha salva, segue o tema do sistema da pessoa.
(function () {
  var KEY = 'bi-probeef:tema';
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch (e) {
    // Sem armazenamento local (janela anônima, por exemplo): segue o sistema.
  }

  function current() {
    return root.dataset.theme || (media.matches ? 'dark' : 'light');
  }

  function sync() {
    var mode = current();
    var label = mode === 'dark' ? 'Usar tema claro' : 'Usar tema escuro';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.dataset.mode = mode;
      button.setAttribute('aria-label', label);
      button.title = label;
    });
  }

  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {
      // Não lembra a escolha, mas troca o tema mesmo assim.
    }
    sync();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', toggle);
    });
    sync();
  });
  media.addEventListener('change', sync);
})();
