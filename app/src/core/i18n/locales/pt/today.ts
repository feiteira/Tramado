// Português europeu: `today` (UX §5.5). Registo "você" implícito; Disciplina, Aula, Exame, apontamentos.
import type { Messages } from '../en';

export const today: Messages['today'] = {
  title: 'Hoje',
  greeting: { morning: 'Bom dia, {name}', afternoon: 'Boa tarde, {name}', evening: 'Boa noite, {name}' },
  checklist: {
    title: 'Primeiros passos',
    classes: 'Criar ou entrar numa disciplina',
    lecture: 'Gravar ou adicionar uma aula',
    document: 'Adicionar um documento',
    exam: 'Adicionar uma data de exame',
    dismiss: 'Ocultar a lista',
    whichClass: 'Em que disciplina?',
  },
  exams: {
    title: 'Próximos exames',
    today: 'Hoje, {time}',
    tomorrow: 'Amanhã, {time}',
    inDays: { one: 'Daqui a {n} dia · {date}', other: 'Daqui a {n} dias · {date}' },
    practise: 'Praticar ({n})',
  },
  transcriptions: {
    title: 'Transcrições',
    idle: 'Este computador: sem tarefas',
    local: 'Este computador: {lecture} · {percent} %',
    other: '{device} · {lecture} · {percent} %',
    waiting: { one: '{n} à espera de quem transcreva', other: '{n} à espera de quem transcreva' },
    here: 'Transcrever aqui',
  },
  lectures: { title: 'Aulas recentes' },
  unread: {
    title: 'Por ler',
    summary: { one: '{n} mensagem', other: '{n} mensagens' },
    pins: { one: '{n} mensagem afixada nova', other: '{n} mensagens afixadas novas' },
    mentions: { one: '{n} menção', other: '{n} menções' },
  },
  empty: {
    title: 'Boas-vindas, {name}.',
    body: 'Uma disciplina reúne as aulas, os documentos, os exames e os apontamentos de uma cadeira, e pode ser partilhada com os colegas.',
    create: 'Criar uma disciplina',
    join: 'Entrar numa disciplina',
  },
  clear: { title: 'Nada pendente para hoje.', body: 'Não há exames nas próximas 3 semanas nem nada à espera.' },
};
