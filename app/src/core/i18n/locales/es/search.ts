// Spanish (Spain) catalog `search` (UI-DOCS). Register: "usted"; asignatura, clase, apunte.
import type { Messages } from '../en';

export const search: Messages['search'] = {
  placeholder: 'Busque en sus asignaturas o escriba un comando…',
  label: 'Búsqueda y comandos',
  scopeClass: 'En {class}',
  scopeAll: 'Todas las asignaturas',
  includeArchived: 'Incluir asignaturas archivadas',
  groups: { lectures: 'Clases', documents: 'Documentos', notes: 'Apuntes', exams: 'Exámenes', chat: 'Chat', commands: 'Comandos', recent: 'Recientes', recentSearches: 'Búsquedas recientes' },
  showAll: 'Mostrar todos ({n})',
  askAi: 'Preguntar a la IA: «{q}» en {scope}',
  askAiAll: 'Preguntar a la IA: «{q}» en todas las asignaturas',
  askAiOff: 'Preguntar a la IA (configure la IA primero)',
  indexing: { one: 'Aún se está leyendo {n} archivo; los resultados pueden estar incompletos.', other: 'Aún se están leyendo {n} archivos; los resultados pueden estar incompletos.' },
  none: { title: 'No se encontró nada para «{q}».', body: 'Pruebe con menos palabras o busque en todas las asignaturas.', all: 'Buscar en todas las asignaturas', ask: 'Preguntar a la IA' },
  result: '{kind}: {title}, {where}. {snippet}',
  kinds: { lecture: 'Clase', document: 'Documento', note: 'Apunte', exam: 'Pregunta de examen', chat: 'Mensaje', command: 'Comando' },
  chatWhere: '{name}, {date}',
};
