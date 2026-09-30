// P7: verificação anti-robô (Cloudflare Turnstile) e honeypot nos formulários públicos (login, solicitação sem login,
// cadastro de profissional). O token vai junto da chamada à function "conta", que confere com a Cloudflare; aqui é só
// a caixinha. Sem chave configurada (mock, testes locais) nada é montado e nada é enviado.
import { el } from './dom.js';
import { TURNSTILE_SITEKEY } from '../config/app.js';
import { usarProvaHumana } from '../services/supabase.js';

let carregando = null;
let widget = null;
let token = null;
let esperando = [];
let honeypot = null;
let caixaAtual = null;

function carregarScript() {
  if (!carregando) {
    carregando = new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = () => ok(); s.onerror = () => { carregando = null; falha(new Error('turnstile')); };
      document.head.appendChild(s);
    });
  }
  return carregando;
}

/** Caixinha da verificação + campo isca (invisível pra pessoas; robô preenche). Devolve o elemento pra pôr no formulário. */
export function blocoVerificacao() {
  honeypot = el('input', { type: 'text', name: 'site_empresa', tabindex: -1, autocomplete: 'off', 'aria-hidden': 'true', class: 'isca' });
  const caixa = el('div', { class: 'verificacao', dataset: { turnstile: '' } });
  caixaAtual = caixa; token = null;
  if (TURNSTILE_SITEKEY) {
    carregarScript().then(() => {
      widget = window.turnstile.render(caixa, {
        sitekey: TURNSTILE_SITEKEY, language: 'pt-br', theme: 'light', size: 'flexible',
        callback: (t) => { token = t; for (const f of esperando.splice(0)) f(t); },
        'expired-callback': () => { token = null; }, 'error-callback': () => { token = null; },
      });
    }).catch(() => {});
  }
  return el('div', {}, [honeypot, caixa]);
}

/** Token de uso único (espera a caixinha até 20 s) e o valor da isca. Depois de usar, a caixinha renova. */
export async function provaHumana() {
  const hp = honeypot?.value || '';
  if (!TURNSTILE_SITEKEY) return { hp };
  // sem caixinha na tela (ex.: a entrada de novo depois da troca obrigatória de senha, com o formulário já trocado): monta outra
  if (!caixaAtual?.isConnected) blocoAutomatico(); // a caixinha da tela pode estar ainda carregando: aí só espera o token
  const t = token || await new Promise((ok) => { esperando.push(ok); setTimeout(() => ok(null), 20000); });
  token = null;
  try { if (widget !== null) window.turnstile.reset(widget); } catch { /* recarrega na próxima */ }
  return { turnstile: t || '', hp };
}

usarProvaHumana(provaHumana);

/** Formulário sem lugar reservado (ex. login dentro da solicitação): monta a caixinha no fim da página. */
function blocoAutomatico() {
  const main = document.querySelector('main') || document.body;
  main.appendChild(blocoVerificacao());
}
