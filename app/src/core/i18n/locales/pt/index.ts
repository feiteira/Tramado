// Portuguese (Portugal) catalogs. Each file is typed Messages['<ns>'], so a missing key fails tsc.
// Frozen after M0: namespace owners translate their own files and remove `pending`.
import type { Messages } from '../en';
import { common } from './common';
import { app } from './app';
import { sync } from './sync';
import { onboarding } from './onboarding';
import { today } from './today';
import { classes } from './classes';
import { lectures } from './lectures';
import { record } from './record';
import { documents } from './documents';
import { notes } from './notes';
import { exams } from './exams';
import { chat } from './chat';
import { ask } from './ask';
import { ai } from './ai';
import { members } from './members';
import { search } from './search';
import { settings } from './settings';
import { privacy } from './privacy';
import { speech } from './speech';
import { errors } from './errors';
import { a11y } from './a11y';
import { notify } from './notify';

export const pt: Messages = {
  common,
  app,
  sync,
  onboarding,
  today,
  classes,
  lectures,
  record,
  documents,
  notes,
  exams,
  chat,
  ask,
  ai,
  members,
  search,
  settings,
  privacy,
  speech,
  errors,
  a11y,
  notify,
};
