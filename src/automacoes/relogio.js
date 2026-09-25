// Relógio injetável. O motor e os casos de uso nunca chamam Date.now() direto: assim os testes e a tela de dev
// conseguem simular "18h da véspera".

/** Relógio real, com deslocamento opcional (ms) pra simulação. */
export function criarRelogio({ deslocamentoMs = 0, lerDeslocamento, gravarDeslocamento } = {}) {
  let desloc = lerDeslocamento ? Number(lerDeslocamento()) || 0 : deslocamentoMs;
  return {
    agora: () => new Date(Date.now() + desloc),
    avancar(ms) { desloc += ms; gravarDeslocamento?.(desloc); return new Date(Date.now() + desloc); },
    irPara(iso) { desloc = Date.parse(iso) - Date.now(); gravarDeslocamento?.(desloc); return new Date(Date.parse(iso)); },
    zerar() { desloc = 0; gravarDeslocamento?.(0); },
    deslocamento: () => desloc,
  };
}

/** Relógio parado num instante (testes). */
export function criarRelogioFixo(iso) {
  let t = Date.parse(iso);
  return {
    agora: () => new Date(t),
    avancar(ms) { t += ms; return new Date(t); },
    irPara(novo) { t = Date.parse(novo); return new Date(t); },
    zerar() {},
    deslocamento: () => 0,
  };
}
