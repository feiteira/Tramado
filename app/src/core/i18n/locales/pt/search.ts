// Portuguese (Portugal) catalog `search` (UI-DOCS). Register: "você" implied; disciplina, aula, apontamento.
import type { Messages } from '../en';

export const search: Messages['search'] = {
  placeholder: 'Pesquise nas suas disciplinas ou escreva um comando…',
  label: 'Pesquisa e comandos',
  scopeClass: 'Em {class}',
  scopeAll: 'Todas as disciplinas',
  includeArchived: 'Incluir disciplinas arquivadas',
  groups: { lectures: 'Aulas', documents: 'Documentos', notes: 'Apontamentos', exams: 'Exames', chat: 'Chat', commands: 'Comandos', recent: 'Recentes', recentSearches: 'Pesquisas recentes' },
  showAll: 'Mostrar todos ({n})',
  askAi: 'Perguntar à IA: “{q}” em {scope}',
  askAiAll: 'Perguntar à IA: “{q}” em todas as disciplinas',
  askAiOff: 'Perguntar à IA (configure a IA primeiro)',
  indexing: { one: 'Ainda a ler {n} ficheiro; os resultados podem estar incompletos.', other: 'Ainda a ler {n} ficheiros; os resultados podem estar incompletos.' },
  none: { title: 'Nada encontrado para “{q}”.', body: 'Experimente menos palavras ou pesquise em todas as disciplinas.', all: 'Pesquisar em todas as disciplinas', ask: 'Perguntar à IA' },
  result: '{kind}: {title}, {where}. {snippet}',
  kinds: { lecture: 'Aula', document: 'Documento', note: 'Apontamento', exam: 'Pergunta de exame', chat: 'Mensagem', command: 'Comando' },
  chatWhere: '{name}, {date}',
};
