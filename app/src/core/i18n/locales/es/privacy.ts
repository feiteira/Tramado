// Español (España): `privacy` (UX §5.18). Registro "usted"; Asignatura, Clase, apuntes, archivo.
import type { Messages } from '../en';

export const privacy: Messages['privacy'] = {
  title: 'Qué sale de este ordenador',
  intro: 'Tramado no tiene servidor ni cuenta. Esto es todo lo que sale de su ordenador, y cuándo.',
  columns: { when: 'Cuándo', what: 'Qué se envía', to: 'A quién' },
  rows: {
    nothing: { when: 'Nada configurado', what: 'Nada. Tramado no establece conexiones por su cuenta.', to: '—' },
    sharing: { when: 'Comparte una asignatura o se une a una', what: 'Los archivos de la asignatura, el chat, su nombre y el nombre de su ordenador, cifrados entre los ordenadores de sus compañeros. El identificador y la dirección IP de su ordenador van a los servidores de descubrimiento y de retransmisión de Syncthing, y se anuncian en su red local, para que sus compañeros encuentren su ordenador. (Ajustes › Sincronización › Solo red local desactiva los servidores.)', to: 'Los ordenadores de sus compañeros; los servidores públicos de descubrimiento, retransmisión y STUN de Syncthing' },
    joinPage: { when: 'Abre el enlace de una invitación en un navegador (o escanea el código QR de una invitación)', what: 'Su navegador pide la página de invitaciones de Tramado a GitHub Pages: GitHub ve su dirección IP y los datos de su navegador, como en cualquier página web. El código de la invitación va en la parte del enlace que sigue a «#», que nunca se envía; la página lo lee en su dispositivo.', to: 'GitHub (EE. UU.), que aloja la página de invitaciones' },
    keyCheck: { when: 'Ha guardado una clave de OpenRouter y la IA está activada', what: 'Su clave, para saber cuántas solicitudes gratuitas le quedan (al iniciar Tramado, al volver a él pasado un rato y al probar la clave), y una vez al día una solicitud de la lista de modelos. Ninguna pregunta ni contenido de las asignaturas.', to: 'OpenRouter (EE. UU.)' },
    ai: { when: 'Pregunta a la IA (Preguntar, @IA, Explicar, respuestas de examen, resúmenes)', what: 'Su pregunta y los fragmentos necesarios (con los nombres de los archivos y los tiempos). Nunca carpetas enteras, apuntes privados (salvo que incluya Mis apuntes), el historial del chat ni otras asignaturas.', to: 'OpenRouter (EE. UU.) y la empresa que ejecuta el modelo' },
    ocr: { when: 'Lee con la IA un examen o documento escaneado', what: 'Las imágenes de las páginas', to: 'OpenRouter y el proveedor del modelo' },
    cloudSpeech: { when: 'Transcribe con OpenRouter', what: 'La grabación, en fragmentos de hasta 30 segundos', to: 'OpenRouter y el proveedor del modelo de voz' },
    customAi: { when: 'Usa otro servicio de IA (Ajustes › IA › Otro servicio)', what: 'Lo mismo que para OpenRouter: su pregunta y los fragmentos necesarios, imágenes de páginas para leer, grabaciones para transcribir.', to: 'La dirección que indicó (su ordenador, su red o el servidor de su centro)' },
    model: { when: 'Descarga un modelo de voz', what: 'Una solicitud de descarga', to: 'Hugging Face' },
    never: { when: 'Nunca', what: 'Sin cuenta, sin telemetría, sin estadísticas de uso, sin informes de errores. Los informes de uso de Syncthing están desactivados.', to: '—' },
  },
  log: {
    title: 'Actividad de la IA en este ordenador',
    intro: 'Una lista privada de las solicitudes a la IA hechas desde este ordenador. Nunca se envía a ninguna parte.',
    columns: { time: 'Hora', class: 'Asignatura', action: 'Acción', model: 'Modelo', passages: 'Fragmentos enviados', requests: 'Solicitudes' },
    actions: { ask: 'Preguntar', chat: '@IA en el chat', explain: 'Explicar', summary: 'Resumen', terms: 'Términos clave', annotate: 'Anotar la transcripción', studyNotes: 'Apuntes de estudio', examExtract: 'Examen: buscar preguntas', examOcr: 'Examen: leer páginas', examAnswer: 'Examen: responder', hint: 'Pista', deep: 'Respuesta en profundidad', title: 'Título de la clase', describe: 'Describir imagen', docOcr: 'Leer un documento escaneado', cloudSpeech: 'Transcripción en la nube', keyCheck: 'Comprobación de la clave', catalog: 'Lista de modelos' },
    clear: 'Vaciar el registro',
    empty: 'Aún no hay solicitudes a la IA.',
    clearConfirm: { title: '¿Vaciar el registro de actividad de la IA?', body: 'Se elimina la lista de solicitudes a la IA hechas desde este ordenador. Nada más cambia: sus respuestas, apuntes y asignaturas se conservan.' },
    cleared: 'El registro de actividad de la IA está vacío.',
  },
  where: { title: 'Dónde están sus datos', classes: 'Abrir la carpeta de asignaturas', private: 'Abrir la carpeta de datos privados', models: 'Abrir la carpeta de modelos', cache: 'Abrir la carpeta de caché' },
  whereBody: 'Sus asignaturas son carpetas corrientes, donde eligió guardarlas (Ajustes › Almacenamiento). Los datos privados de Tramado (sus propios apuntes, resaltados, práctica y el registro de actividad de la IA), los modelos de voz y la caché están en las carpetas propias de Tramado en este ordenador y nunca se comparten.',
};
