// Português europeu: `notify` (UX §5.22).
import type { Messages } from '../en';

export const notify: Messages['notify'] = {
  mention: '{name} referiu-se a si em {class}',
  everyone: '{name} para todos em {class}',
  pin: '{name} afixou uma mensagem em {class}',
  examAdded: 'Nova data de exame em {class}: {title}, {date}',
  examChanged: 'Data de exame alterada: {title} passa a {date}',
  examSoon: '{title} de {class} é {when}',
  transcriptReady: 'A transcrição de “{lecture}” está pronta',
  transcriptFailed: 'A transcrição de “{lecture}” falhou em {device}',
  transcriptNobody: 'Ainda ninguém transcreveu “{lecture}”.',
  joined: '{name} entrou em {class}',
  wantsToJoin: '{name} quer entrar em {class}',
  recordingInterrupted: 'Uma gravação de {class} foi interrompida',
  modelReady: 'O modelo de voz está pronto',
  volunteerOn: 'Este computador vai ajudar a transcrever as aulas das suas disciplinas quando estiver ligado à corrente.',
  massDelete: 'O computador de {name} eliminou {n} ficheiros de {class}',
  folderMissing: 'O Tramado não encontra a pasta de {class}',
  backgroundRecording: 'A gravação de {class} continua em segundo plano.',
};
