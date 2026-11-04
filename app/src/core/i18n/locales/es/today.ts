// Español (España): `today` (UX §5.5). Registro "usted"; Asignatura, Clase, Examen, apuntes.
import type { Messages } from '../en';

export const today: Messages['today'] = {
  title: 'Hoy',
  greeting: { morning: 'Buenos días, {name}', afternoon: 'Buenas tardes, {name}', evening: 'Buenas noches, {name}' },
  checklist: {
    title: 'Primeros pasos',
    classes: 'Crear o unirse a una asignatura',
    lecture: 'Grabar o añadir una clase',
    document: 'Añadir un documento',
    exam: 'Añadir una fecha de examen',
    dismiss: 'Ocultar la lista',
    whichClass: '¿En qué asignatura?',
  },
  exams: {
    title: 'Próximamente',
    today: 'Hoy, {time}',
    tomorrow: 'Mañana, {time}',
    inDays: { one: 'Dentro de {n} día · {date}', other: 'Dentro de {n} días · {date}' },
    practise: 'Practicar ({n})',
  },
  transcriptions: {
    title: 'Transcripciones',
    idle: 'Este ordenador: sin tareas',
    local: 'Este ordenador: {lecture} · {percent} %',
    other: '{device} · {lecture} · {percent} %',
    waiting: { one: '{n} esperando a que alguien la transcriba', other: '{n} esperando a que alguien las transcriba' },
    here: 'Transcribir aquí',
  },
  lectures: { title: 'Clases recientes' },
  unread: {
    title: 'Sin leer',
    summary: { one: '{n} mensaje', other: '{n} mensajes' },
    pins: { one: '{n} mensaje fijado nuevo', other: '{n} mensajes fijados nuevos' },
    mentions: { one: '{n} mención', other: '{n} menciones' },
  },
  empty: {
    title: 'Le damos la bienvenida, {name}.',
    body: 'Una asignatura reúne las clases, los documentos, los exámenes y los apuntes de una materia, y puede compartirse con sus compañeros.',
    create: 'Crear una asignatura',
    join: 'Unirse a una asignatura',
  },
  clear: { title: 'Nada pendiente para hoy.', body: 'No hay exámenes en las próximas 3 semanas ni nada en espera.' },
};
