// Helper do Playwright: aponta LD_LIBRARY_PATH pras libs extraídas sem sudo (ver README) e sobe o servidor local.
// AUT (fase 2): contra o servidor LOCAL (mock), o relógio do navegador fica fixo num horário comercial de hoje (11h de
// Brasília; domingo/feriado vai pro próximo dia livre). Sem isso, rodar os testes à noite adiaria as mensagens pro
// horário silencioso (regra certa, teste dependente da hora). Os testes de preview seguem no relógio real (o token do
// Supabase é validado pelo relógio do navegador).
import { chromium } from 'playwright';
import { criarServidor } from './serve.mjs';
import { dataNoFuso, somarDias, diaDaSemana, instanteLocal } from '../src/domain/calendario.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';

let servidorLocal = false;

/** 11h de Brasília de hoje (ou do próximo dia que não é domingo nem feriado). */
export function horarioComercial() {
  let d = dataNoFuso(new Date().toISOString());
  while (diaDaSemana(d) === 0 || CONFIG_PRECOS.feriados.includes(d)) d = somarDias(d, 1);
  return instanteLocal(d, 11, 0);
}

export async function abrirNavegador() {
  const b = await chromium.launch();
  const novoContexto = b.newContext.bind(b);
  b.newContext = async (op) => {
    const ctx = await novoContexto(op);
    if (servidorLocal) await ctx.clock.setFixedTime(new Date(horarioComercial()));
    return ctx;
  };
  b.newPage = async (op) => (await b.newContext(op)).newPage();
  return b;
}

export async function subirServidor(porta = 0) {
  servidorLocal = true;
  const srv = criarServidor();
  await new Promise((r) => srv.listen(porta, r));
  const base = `http://localhost:${srv.address().port}/LP-prime-limpeza/`;
  return { srv, base, fechar: () => new Promise((r) => srv.close(r)) };
}
