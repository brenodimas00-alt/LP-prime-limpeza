// Home (HTML estático do Breno): troca "Entrar" por "Minha conta" quando há sessão, apontando pra área do papel.
// Script clássico, sem módulo, pra não mexer no carregamento da home. Só textContent/href.
(function () {
  var s = null;
  try { s = JSON.parse(localStorage.getItem('prime.sessao') || 'null'); } catch (e) { return; }
  var destino = { cliente: 'minha-conta/', diarista: 'diarista/agenda/', prime: 'painel/' }[s && s.ator];
  if (!destino) return;
  document.querySelectorAll('[data-conta]').forEach(function (a) {
    a.setAttribute('href', destino);
    var rot = a.querySelector('span');
    if (rot) rot.textContent = 'Minha conta';
    if (a.hasAttribute('aria-label')) a.setAttribute('aria-label', 'Minha conta');
  });
})();
