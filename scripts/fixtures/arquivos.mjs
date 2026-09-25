// Arquivos fictícios de teste (lidos do disco no Node).
import { readFileSync } from 'node:fs';
const ler = (n) => new Uint8Array(readFileSync(new URL(n, import.meta.url)));
export const ARQUIVOS = {
  png: { bytes: ler('./foto-ficticia.png'), mime: 'image/png', ext: 'png' },
  pdf: { bytes: ler('./documento-ficticio.pdf'), mime: 'application/pdf', ext: 'pdf' },
};
