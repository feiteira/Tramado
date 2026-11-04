// Español de España: `notify` (UX §5.22).
import type { Messages } from '../en';

export const notify: Messages['notify'] = {
  mention: '{name} le ha mencionado en {class}',
  everyone: '{name} a todos en {class}',
  pin: '{name} ha fijado un mensaje en {class}',
  examAdded: 'Nueva fecha de examen en {class}: {title}, {date}',
  examChanged: 'Fecha de examen cambiada: {title} pasa al {date}',
  examSoon: '{title} de {class} es {when}',
  transcriptReady: 'La transcripción de «{lecture}» está lista',
  transcriptFailed: 'La transcripción de «{lecture}» ha fallado en {device}',
  transcriptNobody: 'Nadie ha transcrito todavía «{lecture}».',
  joined: '{name} se ha unido a {class}',
  wantsToJoin: '{name} quiere unirse a {class}',
  recordingInterrupted: 'Se ha interrumpido una grabación de {class}',
  modelReady: 'El modelo de voz está listo',
  volunteerOn: 'Este ordenador ayudará a transcribir las clases de sus asignaturas cuando esté enchufado.',
  massDelete: 'El ordenador de {name} ha eliminado {n} archivos de {class}',
  folderMissing: 'Tramado no encuentra la carpeta de {class}',
  backgroundRecording: 'La grabación de {class} continúa en segundo plano.',
};
