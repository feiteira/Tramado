// Architecture §9 (verbatim): the TypeScript side of the IPC contract (§6–§7). A field added here MUST be
// added to the Rust twin in the same change (§19.2: additive changes only, by the owning work package).
// Frozen after M0 (§19.1): the shape of `Platform`.
import type { ClassId, ClassPath, DeviceId, Hex64, PickToken, Ulid, Unsubscribe, ConfirmText, FileFilter } from './common';
import type { AppFileName, AppInfo, CacheKey, PersonInfo, PersonProof, Power, RustDiagnostics, StorageUsage, TrayAction } from './app';
import type { AdoptedClass, ClassChangedEvent, ClassEntry, ClassesRoot, ClassFileEntry, CreatedClass, FileStamp, Picked } from './classes';
import type { AiActivityEntry, AiHost, AiPipeRequest, AiWireEvent, PrivacyLevel, SecretName, SecretStatus } from './ai';
import type { AcceptFolderRequest, CaughtUp, ClassPolicy, DeviceStat, ExistingSyncthing, FileSyncInfo, FolderError, FolderView, JoinRequest, LeaveOptions, MassDeleteAction, RestoreItem, Sig, SyncDiagnostics, SyncEvent, SyncIdentity, SyncSettings, SyncSnapshot, SyncStatus, VersionEntry } from './sync';
import type { AudioDevices, AudioSource, FinishedRecording, ImportAudioRequest, ImportEvent, JobSummary, Marker, MarkerKind, MeterEvent, MeterRequest, ModelEvent, ModelId, ModelState, PublishedAudio, PublishRequest, RecorderEvent, RecorderStartRequest, RecorderStatus, SpeechInfo, TranscribeEvent, TranscribeRequest, TranscriptionResult } from './speech';

export * from './common';
export * from './app';
export * from './classes';
export * from './ai';
export * from './sync';
export * from './speech';

export interface Platform {
  readonly kind: 'desktop' | 'demo' | 'test';
  info(): Promise<AppInfo>;
  log(level: 'error' | 'warn' | 'info', message: string, data?: object): void;   // fire-and-forget

  appFiles: {
    read(name: AppFileName): Promise<string | null>;
    write(name: AppFileName, text: string): Promise<void>;                          // atomic
  };
  privateFiles: {                                                                    // data/private/<classId>/ (never synced)
    read(classId: ClassId, path: string): Promise<Uint8Array | null>;
    write(classId: ClassId, path: string, bytes: Uint8Array): Promise<void>;
    append(classId: ClassId, path: string, line: Uint8Array): Promise<number>;
    list(classId: ClassId, dir: string): Promise<string[]>;
    remove(classId: ClassId, path: string, recursive?: boolean): Promise<void>;
    purge(classId: ClassId): Promise<void>;
  };
  cache: {
    read(key: CacheKey): Promise<Uint8Array | null>;
    write(key: CacheKey, bytes: Uint8Array): Promise<void>;
    remove(key: CacheKey): Promise<void>;
    clear(): Promise<void>;
  };
  person: {                                                                         // folder spec §8.3.1
    init(): Promise<PersonInfo>;
    prove(classId: ClassId): Promise<PersonProof>;
  };
  storage: {
    usage(): Promise<StorageUsage>;
    reveal(which: 'classesRoot' | 'private' | 'models' | 'cache', classId?: ClassId): Promise<void>;
    /** INT (wave 3, `storage_free`): bytes free where Tramado writes (app data and classes root, the smaller); null = unknown. */
    diskFree(): Promise<number | null>;
  };

  classes: {                                                                         // registry (config/classes.json)
    list(): Promise<ClassEntry[]>;
    root(): Promise<ClassesRoot>;
    setRoot(pick: PickToken): Promise<ClassesRoot>;
    create(req: { classId: ClassId; dirName: string; parent?: PickToken }): Promise<CreatedClass>;
    adopt(pick: PickToken): Promise<AdoptedClass>;
    fork(classId: ClassId, newClassId: ClassId): Promise<ClassEntry>;
    update(classId: ClassId, patch: { archived?: boolean; skipAudio?: boolean; localIgnores?: ClassPath[]; /** INT: "Get the recording" */ localIncludes?: ClassPath[] }): Promise<ClassEntry>;
    forget(classId: ClassId): Promise<void>;
    trash(classId: ClassId): Promise<void>;
    emptyTrash(classId: ClassId): Promise<void>;
    reveal(classId: ClassId, path?: ClassPath): Promise<void>;
    open(classId: ClassId, path: ClassPath): Promise<void>;
  };
  fs: {                                                                              // inside one registered class, confined
    list(classId: ClassId, dir: ClassPath | '', opts: { recursive: boolean; maxDepth?: number; includeTramado?: boolean }): Promise<ClassFileEntry[]>;
    stat(classId: ClassId, path: ClassPath): Promise<ClassFileEntry | null>;
    read(classId: ClassId, path: ClassPath): Promise<Uint8Array>;
    readRange(classId: ClassId, path: ClassPath, offset: number, length: number): Promise<Uint8Array>;
    write(classId: ClassId, path: ClassPath, bytes: Uint8Array, opts: { own: boolean }): Promise<FileStamp>;
    append(classId: ClassId, path: ClassPath, line: Uint8Array, opts: { own: boolean }): Promise<FileStamp>;
    mkdir(classId: ClassId, path: ClassPath): Promise<void>;
    move(classId: ClassId, from: ClassPath, to: ClassPath): Promise<void>;
    remove(classId: ClassId, path: ClassPath, opts?: { recursive?: boolean }): Promise<void>;
    hash(classId: ClassId, path: ClassPath): Promise<Hex64>;
    importFile(classId: ClassId, pick: PickToken, dest: ClassPath): Promise<FileStamp>;
    exportFile(classId: ClassId, path: ClassPath, pick: PickToken): Promise<void>;
  };
  dialogs: {
    pickFiles(req: { title: string; filters: FileFilter[]; multiple: boolean }): Promise<Picked[]>;
    pickFolder(req: { title: string }): Promise<Picked | null>;
    save(req: { title: string; defaultName: string; filters: FileFilter[] }): Promise<Picked | null>;
    /** G2: "Save as a file…" for a small text (≤ 1 MiB: an invite file, a diagnostics log); false when cancelled. */
    saveText(req: { title: string; defaultName: string; filters: FileFilter[] }, text: string): Promise<boolean>;
  };
  secrets: {
    set(name: SecretName, value: string): Promise<SecretStatus>;
    status(name: SecretName): Promise<SecretStatus>;
    clear(name: SecretName): Promise<void>;
  };
  ai: {
    send(req: AiPipeRequest, onEvent: (e: AiWireEvent) => void): Promise<void>;     // resolves when the worker started
    cancel(requestId: string): Promise<void>;
    hosts(): Promise<AiHost[]>;
    allowHost(base: string, text: ConfirmText): Promise<AiHost | null>;
    forgetHost(hostId: string): Promise<void>;
    privacy(): Promise<PrivacyLevel>;
    setPrivacy(level: PrivacyLevel, text: ConfirmText): Promise<boolean>;
    busyPolicy(): Promise<boolean>;
    setBusyPolicy(relax: boolean, text: ConfirmText): Promise<boolean>;
    activity(limit: number): Promise<AiActivityEntry[]>;
    clearActivity(): Promise<void>;
  };
  sync: {
    identity(): Promise<SyncIdentity>;
    resolveCopiedIdentity(action: 'new' | 'same'): Promise<SyncIdentity>;
    start(): Promise<SyncStatus>;
    restart(): Promise<SyncStatus>;
    status(): Promise<SyncStatus>;
    snapshot(): Promise<SyncSnapshot>;
    applySettings(s: SyncSettings): Promise<void>;
    setPolicy(p: ClassPolicy): Promise<void>;
    sign(classId: ClassId, path: ClassPath, canonical: Uint8Array): Promise<Sig>;   // folder spec §6.6, sync spec §12.4
    shareClass(classId: ClassId, label: string): Promise<ClassEntry>;
    joinClass(req: JoinRequest): Promise<ClassEntry>;
    cancelJoin(classId: ClassId): Promise<void>;
    acceptFolder(req: AcceptFolderRequest): Promise<ClassEntry>;
    leaveClass(classId: ClassId, opts: LeaveOptions): Promise<void>;
    admit(classId: ClassId, deviceId: DeviceId): Promise<void>;
    decline(classId: ClassId, deviceId: DeviceId): Promise<void>;
    resolveMassDelete(classId: ClassId, action: MassDeleteAction): Promise<void>;
    normalizeIds(ids: string[]): Promise<Array<DeviceId | null>>;
    ownAddresses(): Promise<string[]>;
    fileInfo(classId: ClassId, paths: ClassPath[]): Promise<FileSyncInfo[]>;
    waitAvailable(classId: ClassId, path: ClassPath, minDevices: number, timeoutMs: number): Promise<boolean>;
    waitCaughtUp(classId: ClassId, timeoutMs: number): Promise<CaughtUp>;
    deviceStats(): Promise<Record<DeviceId, DeviceStat>>;
    folderStatus(classId: ClassId): Promise<FolderView>;
    versions(classId: ClassId): Promise<VersionEntry[]>;
    restore(classId: ClassId, items: RestoreItem[]): Promise<void>;
    folderErrors(classId: ClassId): Promise<FolderError[]>;
    pauseClass(classId: ClassId, paused: boolean): Promise<void>;
    scan(classId: ClassId, path?: ClassPath): Promise<void>;
    diagnostics(): Promise<SyncDiagnostics>;
    existing(): Promise<ExistingSyncthing>;
  };
  speech?: {                                                                         // absent in the demo unless ?speech=fake
    info(): Promise<SpeechInfo>;
    models(): Promise<ModelState[]>;
    downloadModel(id: ModelId, onEvent: (e: ModelEvent) => void): Promise<void>;
    attachModel(id: ModelId, onEvent: (e: ModelEvent) => void): Promise<boolean>;
    cancelModel(id: ModelId): Promise<void>;
    deleteModel(id: ModelId): Promise<void>;
    importModel(id: ModelId, pick: PickToken): Promise<ModelState>;
    devices(): Promise<AudioDevices>;
    meter: {                                                                        // live input level outside a recording
      start(req: MeterRequest, onEvent: (e: MeterEvent) => void): Promise<void>;
      stop(): Promise<void>;
    };
    recorder: {
      start(req: RecorderStartRequest, onEvent: (e: RecorderEvent) => void): Promise<RecorderStatus>;
      attach(onEvent: (e: RecorderEvent) => void): Promise<RecorderStatus | null>;
      pause(): Promise<RecorderStatus>;
      resume(): Promise<RecorderStatus>;
      /** `atMs` (INT, wave 3): the raw audio time to stamp (a note is stamped when its field opened); default now. */
      mark(kind: MarkerKind, note?: string, atMs?: number): Promise<Marker>;
      /** INT (wave 3, `speech_recorder_unmark`): removes a marker of the running recording (the toast's Undo). */
      unmark(markerId: Ulid): Promise<void>;
      stop(): Promise<FinishedRecording>;
      pending(): Promise<FinishedRecording[]>;
      publish(req: PublishRequest): Promise<PublishedAudio>;
      discard(recordingId: Ulid): Promise<void>;
    };
    importAudio(req: ImportAudioRequest, onEvent: (e: ImportEvent) => void): Promise<void>;
    attachImport(recordingId: Ulid, onEvent: (e: ImportEvent) => void): Promise<boolean>;
    transcribe: {
      start(req: TranscribeRequest, onEvent: (e: TranscribeEvent) => void): Promise<string>;
      attach(jobId: string, onEvent: (e: TranscribeEvent) => void): Promise<JobSummary | null>;
      cancel(jobId: string, keepPartial: boolean): Promise<void>;
      jobs(): Promise<JobSummary[]>;
      take(jobId: string): Promise<TranscriptionResult>;
    };
    peaks(source: AudioSource, buckets: number): Promise<number[]>;
  };
  media: {
    url(source: AudioSource | { kind: 'file'; classId: ClassId; path: ClassPath } | { kind: 'selftest' }): string;   // pure (§8)
    blobUrl(classId: ClassId, path: ClassPath, mime: string): Promise<string>;      // fallback; caller revokes
  };
  notifications: { show(n: { title: string; body: string; tag?: string }): Promise<void> };
  window: {
    setTitle(title: string): Promise<void>;
    onCloseRequested(handler: () => Promise<'hide' | 'quit' | 'stay'>): Unsubscribe;   // one handler; Trama pattern
    show(): Promise<void>;
    hide(): Promise<void>;
    quit(): Promise<void>;
    setBackgroundMode(m: { trayOnClose: boolean; sharedClasses: number }): Promise<void>;
    setZoom(factor: 0.875 | 1 | 1.125 | 1.25 | 1.5): Promise<void>;   // getCurrentWebview().setZoom (capability §18.4); CSS zoom in the demo
    autostart: { get(): Promise<boolean>; set(enabled: boolean): Promise<void> };
  };
  system: {
    power(): Promise<Power>;
    openExternal(url: string, text: ConfirmText): Promise<boolean>;
    setMarkerShortcuts(accelerators: Partial<Record<'important' | 'confused' | 'exam' | 'todo', string>> | null): Promise<void>;
    takePendingLinks(): Promise<string[]>;
    diagnostics(): Promise<RustDiagnostics>;
  };
  events: {
    onClassChanged(cb: (e: ClassChangedEvent) => void): Unsubscribe;
    onSync(cb: (e: SyncEvent) => void): Unsubscribe;
    onDeepLink(cb: (e: { url: string; text?: string }) => void): Unsubscribe;
    onShortcut(cb: (e: { id: 'marker'; kind: MarkerKind }) => void): Unsubscribe;
    onTray(cb: (action: TrayAction) => void): Unsubscribe;
    onDrop(cb: (e: { picked: Picked[]; x: number; y: number }) => void): Unsubscribe;   // drag and drop (tokens, D-4)
    /** INT (wave 3, `app:drag`): files dragged over the window (names only) or gone; the drop overlay follows it. */
    onDrag(cb: (e: { state: 'enter' | 'leave'; names: string[] }) => void): Unsubscribe;
  };
}
