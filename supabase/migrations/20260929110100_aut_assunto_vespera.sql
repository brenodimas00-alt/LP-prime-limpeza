-- Revisão do bloco 2: o assunto do e-mail da véspera dizia "amanhã" fixo, mas o lembrete adiado por domingo/feriado/silêncio
-- pode sair no próprio dia (o corpo já usa {{quando}}, que vira "hoje"). Assunto neutro, igual ao catálogo.
update public.templates set assunto = 'Lembrete do seu atendimento Prime' where codigo = 'lembrete_vespera' and canal = 'email' and assunto = 'Lembrete: seu atendimento é amanhã';
update public.templates set assunto = 'Lembrete da sua próxima diária' where codigo = 'lembrete_vespera_profissional' and canal = 'email' and assunto = 'Lembrete: diária de amanhã';
