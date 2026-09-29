// AUT.5: e-mail transacional no visual da marca (azul e dourado da home), HTML com CSS inline (clientes de e-mail
// ignoram <style>), texto escapado e links do próprio texto viram botão. PURO. O mesmo texto do WhatsApp vira o corpo.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** @param {{assunto:string, texto:string, urlSite?:string}} p @returns {{assunto:string, html:string, texto:string}} */
export function layoutEmail({ assunto, texto, urlSite = 'https://primelimpezaespecializada.com.br/' }) {
  const links = [...String(texto).matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[.,)]+$/, ''));
  const corpo = esc(texto).replace(/https?:\/\/[^\s<]+/g, (u) => { const l = u.replace(/[.,)]+$/, ''); return `<a href="${l}" style="color:#2a2456">${l}</a>${u.slice(l.length)}`; })
    .split('\n').map((l) => `<p style="margin:0 0 12px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#201e1d">${l}</p>`).join('');
  const botao = links[0] ? `<p style="margin:20px 0 4px"><a href="${esc(links[0])}" style="display:inline-block;background:#2a2456;color:#ffffff;text-decoration:none;font:bold 15px Arial,Helvetica,sans-serif;padding:12px 22px;border-radius:6px">Abrir</a></p>` : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(assunto)}</title></head>
<body style="margin:0;background:#f4f2ee;padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#2a2456;padding:18px 24px;font:bold 18px Arial,Helvetica,sans-serif;color:#ffffff">Prime Limpeza Especializada</td></tr>
<tr><td style="height:4px;background:#BA984D"></td></tr>
<tr><td style="padding:24px">${corpo}${botao}</td></tr>
<tr><td style="padding:16px 24px;background:#faf8f4;font:12px/1.5 Arial,Helvetica,sans-serif;color:#5b5870">Você recebeu este e-mail por causa de um atendimento com a Prime. <a href="${esc(new URL('privacidade/', urlSite).toString())}" style="color:#5b5870">Política de Privacidade</a></td></tr>
</table></td></tr></table></body></html>`;
  return { assunto, html, texto };
}
