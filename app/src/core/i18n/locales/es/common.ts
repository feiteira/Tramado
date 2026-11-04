// Español de España: `common` (UX §5.1). Registro "usted" (Trama).
import type { Messages } from '../en';

export const common: Messages['common'] = {
  appName: 'Tramado',
  ok: 'Aceptar', cancel: 'Cancelar', save: 'Guardar', close: 'Cerrar', delete: 'Eliminar', remove: 'Quitar', rename: 'Cambiar el nombre',
  edit: 'Editar', add: 'Añadir', create: 'Crear', back: 'Atrás', next: 'Siguiente', continue: 'Continuar', done: 'Hecho',
  skip: 'Omitir', change: 'Cambiar', undo: 'Deshacer', redo: 'Rehacer', search: 'Buscar', filter: 'Filtrar', clear: 'Borrar',
  copy: 'Copiar', copied: 'Copiado', open: 'Abrir', more: 'Más', none: 'Ninguno', all: 'Todos', yes: 'Sí', no: 'No',
  tryAgain: 'Volver a intentarlo', retrying: 'Reintentando…', loading: 'Cargando…', working: 'Trabajando…', saving: 'Guardando…', saved: 'Guardado',
  untitled: 'Sin título', optional: 'opcional', you: 'usted', youSuffix: '{name} (usted)', show: 'Mostrar', hide: 'Ocultar',
  dismiss: 'Descartar', showInFolder: 'Mostrar en la carpeta', openWithSystem: 'Abrir con la aplicación del sistema', paste: 'Pegar',
  chooseFile: 'Elegir un archivo…', chooseFolder: 'Elegir una carpeta…', learnMore: 'Por qué es importante',
  onlyYou: 'Solo para usted', sharedWithClass: 'Compartida', onlyThisComputer: 'Solo en este ordenador',
  arriving: 'Llegando…', arrivingPercent: 'Llegando… {percent} %',
  unknownError: 'Algo ha fallado: {message}',
  size: { b: '{n} B', kb: '{n} KB', mb: '{n} MB', gb: '{n} GB' },
  duration: { hm: '{h} h {m} min', m: '{m} min', s: '{s} s' },
  count: {
    files: { one: '{n} archivo', other: '{n} archivos' },
    pages: { one: '{n} página', other: '{n} páginas' },
    slides: { one: '{n} diapositiva', other: '{n} diapositivas' },
    members: { one: '{n} miembro', other: '{n} miembros' },
    requests: { one: '{n} solicitud', other: '{n} solicitudes' },
    questions: { one: '{n} pregunta', other: '{n} preguntas' },
    lectures: { one: '{n} clase', other: '{n} clases' },
    documents: { one: '{n} documento', other: '{n} documentos' },
  },
  relative: {
    today: 'hoy', tomorrow: 'mañana', yesterday: 'ayer',
    inDays: { one: 'dentro de {n} día', other: 'dentro de {n} días' },
    daysAgo: { one: 'hace {n} día', other: 'hace {n} días' },
    minAgo: { one: 'hace {n} min', other: 'hace {n} min' },
  },
};
