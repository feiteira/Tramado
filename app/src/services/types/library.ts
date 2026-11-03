// Architecture §11.2 (verbatim declarations): service contracts of the `library` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ColourHex, IconName, Lang } from '../../core/model/ids';
import type { Picked } from '../../platform/types';
import type { ClassView } from './viewModels';
import type { ReadableStore } from '../store';

export interface ClassLibrary {
  classes: ReadableStore<ClassView[]>;                   // UX ClassView (archived included; the rail filters)
  load(): Promise<void>;
  create(input: { name: string; shortName?: string; colour: ColourHex; icon: IconName; lecturer?: string; term?: string; language: Lang | 'auto'; vocabulary?: string; share: boolean }): Promise<ClassId>;
      // derives classId from the device ID and a nonce, writes signed class.json, meta and member files (folder spec §2.1, §6.6)
  adopt(pick: Picked): Promise<ClassId>;                 // forks the folder when it holds other devices' member files (sync spec §17)
  archive(classId: ClassId, archived: boolean): Promise<void>;
  forget(classId: ClassId, opts: { trash: boolean }): Promise<void>;
  suggest(name: string): { shortName: string; icon: IconName; colour: ColourHex };
}
