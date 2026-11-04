// Português europeu: `common` (UX §5.1). Registo "você" implícito (Trama).
import type { Messages } from '../en';

export const common: Messages['common'] = {
  appName: 'Tramado',
  ok: 'OK', cancel: 'Cancelar', save: 'Guardar', close: 'Fechar', delete: 'Eliminar', remove: 'Remover', rename: 'Mudar o nome',
  edit: 'Editar', add: 'Adicionar', create: 'Criar', back: 'Voltar', next: 'Seguinte', continue: 'Continuar', done: 'Concluído',
  skip: 'Saltar', change: 'Alterar', undo: 'Anular', redo: 'Refazer', search: 'Pesquisar', filter: 'Filtrar', clear: 'Limpar',
  copy: 'Copiar', copied: 'Copiado', open: 'Abrir', more: 'Mais', none: 'Nenhum', all: 'Todos', yes: 'Sim', no: 'Não',
  tryAgain: 'Tentar novamente', retrying: 'A tentar novamente…', loading: 'A carregar…', working: 'A trabalhar…', saving: 'A guardar…', saved: 'Guardado',
  untitled: 'Sem título', optional: 'opcional', you: 'você', youObject: 'si', youSuffix: '{name} (você)', show: 'Mostrar', hide: 'Ocultar',
  dismiss: 'Dispensar', showInFolder: 'Mostrar na pasta', openWithSystem: 'Abrir com a aplicação do sistema', paste: 'Colar',
  chooseFile: 'Escolher um ficheiro…', chooseFolder: 'Escolher uma pasta…', learnMore: 'Porque é que isto importa',
  onlyYou: 'Só para si', sharedWithClass: 'Partilhado com a turma', onlyThisComputer: 'Só neste computador',
  arriving: 'A chegar…', arrivingPercent: 'A chegar… {percent} %',
  unknownError: 'Algo correu mal: {message}',
  size: { b: '{n} B', kb: '{n} KB', mb: '{n} MB', gb: '{n} GB' },
  duration: { hm: '{h} h {m} min', m: '{m} min', s: '{s} s' },
  count: {
    files: { one: '{n} ficheiro', other: '{n} ficheiros' },
    pages: { one: '{n} página', other: '{n} páginas' },
    slides: { one: '{n} diapositivo', other: '{n} diapositivos' },
    members: { one: '{n} membro', other: '{n} membros' },
    requests: { one: '{n} pedido', other: '{n} pedidos' },
    questions: { one: '{n} pergunta', other: '{n} perguntas' },
    lectures: { one: '{n} aula', other: '{n} aulas' },
    documents: { one: '{n} documento', other: '{n} documentos' },
  },
  relative: {
    today: 'hoje', tomorrow: 'amanhã', yesterday: 'ontem',
    inDays: { one: 'daqui a {n} dia', other: 'daqui a {n} dias' },
    daysAgo: { one: 'há {n} dia', other: 'há {n} dias' },
    minAgo: { one: 'há {n} min', other: 'há {n} min' },
  },
};
