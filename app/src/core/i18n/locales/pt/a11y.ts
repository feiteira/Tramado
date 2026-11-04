// Português europeu: `a11y` (UX §5.21).
import type { Messages } from '../en';

export const a11y: Messages['a11y'] = {
  skipToContent: 'Saltar para o conteúdo',
  screenChanged: '{title}',
  loading: 'A carregar {what}',
  progress: '{what}: {percent} %',
  transcriptionProgress: 'Transcrição {percent} %',
  newMessage: 'Nova mensagem de {name}',
  markerList: 'Marcadores desta aula',
  markerItem: '{kind} aos {time}{note}',
  meter: '{label}: {db} decibéis',
  presence: { online: 'online', syncing: 'a sincronizar', offline: 'sem ligação', recording: 'a gravar', transcribing: 'a transcrever' },
  classTab: 'Cor da disciplina {name}',
  currentSegment: 'Em reprodução',
  highlighted: 'Destacado como {kind}',
  cited: 'Passagem citada',
  hit: 'Resultado da pesquisa',
  dialogClose: 'Fechar',
  required: 'obrigatório',
};
