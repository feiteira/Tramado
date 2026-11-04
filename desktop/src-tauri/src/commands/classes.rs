// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The class registry and class files (architecture §6.2). Every class operation goes through
//! `tramado_base::ClassFs` (registered class, class path rules, symlink refusal); paths from the
//! webview are class paths or pick tokens, never absolute paths (D-4). Every command whose TS type
//! is `ClassEntry` returns `ClassEntryView`. The watcher follows the registry: any class added,
//! moved, forked or removed (also by the sync domain) is watched or unwatched, and changes reach
//! the webview as `class:changed`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt as _;
use tramado_base::classfs::FileStamp;
use tramado_base::confine;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::files::{self, FileEntry, ListOptions};
use tramado_base::ids;
use tramado_base::picks::PickKind;
use tramado_base::registry::{ClassEntry, ClassEntryView};
use tramado_base::watch::{ClassChanged, ClassWatcher};

use crate::commands::events;
use crate::state::Shared;
use crate::util::{blocking, body_bytes, bytes_response, header, header_flag};

/// TS `ClassesRoot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassesRoot {
    pub path: String,
    /// existing child names (TS makes new directory names unique with them)
    pub names: Vec<String>,
}

/// `class_create` argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClassRequest {
    pub class_id: String,
    pub dir_name: String,
    /// pick token of a folder (default: the classes root)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CreateWarning {
    /// the folder is inside OneDrive, Dropbox, iCloud Drive or Google Drive
    CloudFolder,
}

/// TS `CreatedClass`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedClass {
    pub entry: ClassEntryView,
    pub warnings: Vec<CreateWarning>,
}

/// TS `AdoptedClass`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptedClass {
    pub entry: ClassEntryView,
    /// `.tramado/members/` holds files of other devices → TS forks it (sync spec §17)
    pub foreign_members: bool,
}

/// `class_update` patch.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_audio: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_ignores: Option<Vec<String>>,
    /// INT (wave 3): `audio.webm` paths fetched although audio is skipped ("Get the recording").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_includes: Option<Vec<String>>,
}

/// `class_list` options.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOpts {
    pub recursive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_tramado: Option<bool>,
}

/// The classes domain's managed state.
pub struct ClassesState {
    pub watcher: Arc<ClassWatcher>,
}

pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    let emitter = app.clone();
    let watcher = Arc::new(ClassWatcher::new(Arc::new(move |c: ClassChanged| {
        if let Err(e) = emitter.emit(events::CLASS_CHANGED, &c) {
            log::warn!("cannot emit class:changed: {e}");
        }
    })));
    watcher.set_self_writes(shared.fs.clone());
    for e in shared.registry.list() {
        watch_entry(&watcher, &e);
    }
    let w = watcher.clone();
    shared
        .registry
        .subscribe(Box::new(move |before, after| match (before, after) {
            (_, Some(a)) => {
                if let Some(b) = before.filter(|b| b.class_id != a.class_id) {
                    w.unwatch(&b.class_id);
                }
                watch_entry(&w, a);
            }
            (Some(b), None) => w.unwatch(&b.class_id),
            (None, None) => {}
        }));
    app.manage(ClassesState { watcher });
    Ok(())
}

fn watch_entry(w: &ClassWatcher, e: &ClassEntry) {
    if !e.path.is_dir() {
        // A missing (moved, unmounted) class folder: shown as "folder missing", not watched.
        w.unwatch(&e.class_id);
        return;
    }
    if let Err(err) = w.watch(&e.class_id, &e.path) {
        log::warn!("cannot watch class {}: {err}", e.class_id);
    }
}

pub fn on_exit(_app: &AppHandle) {}

fn entry_of(shared: &Shared, class_id: &str) -> AppResult<ClassEntry> {
    shared
        .registry
        .get(class_id)
        .ok_or_else(|| AppError::not_found("no such class"))
}

/// The absolute file behind a class path, confined (no symlink on the way).
fn class_abs(shared: &Shared, class_id: &str, path: &str) -> AppResult<PathBuf> {
    let e = entry_of(shared, class_id)?;
    if !e.path.is_dir() {
        return Err(AppError::not_found("the class folder is missing"));
    }
    confine::confine(&e.path, path)
}

#[tauri::command]
pub async fn classes_list(shared: State<'_, Shared>) -> AppResult<Vec<ClassEntryView>> {
    let registry = shared.registry.clone();
    blocking(move || {
        Ok(registry
            .list()
            .into_iter()
            .map(ClassEntryView::of)
            .collect())
    })
    .await
}

/// Where new classes go: the chosen root, else `~/Tramado` (`$TRAMADO_DATA_DIR/classes`).
fn current_root(shared: &Shared) -> PathBuf {
    shared
        .registry
        .root_dir()
        .unwrap_or_else(|| shared.paths.default_classes_root.clone())
}

/// The names in `dir` (none when it does not exist yet).
pub fn child_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .filter_map(|e| e.file_name().to_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn root_view(path: &Path) -> ClassesRoot {
    ClassesRoot {
        path: path.to_string_lossy().into_owned(),
        names: child_names(path),
    }
}

#[tauri::command]
pub async fn classes_root(shared: State<'_, Shared>) -> AppResult<ClassesRoot> {
    let root = current_root(&shared);
    blocking(move || Ok(root_view(&root))).await
}

/// `PERMISSION_DENIED` when Tramado cannot create files there.
fn check_writable(dir: &Path) -> AppResult<()> {
    let probe = dir.join(format!(".tramado-probe-{}", ids::random_lower_alnum(8)));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Err(AppError::new(
            Code::PermissionDenied,
            "Tramado cannot write in that folder",
        )),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn classes_set_root(shared: State<'_, Shared>, pick: String) -> AppResult<ClassesRoot> {
    let dir = shared.picks.resolve(&pick, PickKind::Folder)?;
    let registry = shared.registry.clone();
    blocking(move || {
        if !dir.is_dir() {
            return Err(AppError::not_found("the folder does not exist"));
        }
        check_writable(&dir)?;
        registry.set_root_dir(dir.clone())?;
        Ok(root_view(&dir))
    })
    .await
}

/// Cloud-synced folders fight with Syncthing over the same files (UX: a warning, not a refusal).
pub fn is_cloud_folder(p: &Path) -> bool {
    let s = p.to_string_lossy().to_ascii_lowercase();
    [
        "onedrive",
        "dropbox",
        "icloud drive",
        "mobile documents",
        "google drive",
    ]
    .iter()
    .any(|m| s.contains(m))
}

/// A class folder name: one valid class path segment.
fn check_dir_name(name: &str) -> AppResult<()> {
    confine::validate_class_path(name)?;
    if name.contains('/') {
        return Err(AppError::invalid("a folder name is one segment"));
    }
    Ok(())
}

/// mkdir `<parent>/<dirName>` and `.tramado/`, then registers the class (`shared: false`).
pub fn create_class(shared: &Shared, req: &CreateClassRequest) -> AppResult<CreatedClass> {
    if !ids::is_class_id(&req.class_id) {
        return Err(AppError::invalid("bad class id"));
    }
    check_dir_name(&req.dir_name)?;
    if shared.registry.get(&req.class_id).is_some() {
        return Err(AppError::new(Code::Conflict, "class already registered"));
    }
    let parent = match &req.parent {
        Some(token) => shared.picks.resolve(token, PickKind::Folder)?,
        None => current_root(shared),
    };
    std::fs::create_dir_all(&parent)?;
    let dir = parent.join(&req.dir_name);
    if std::fs::symlink_metadata(&dir).is_ok() {
        return Err(AppError::new(Code::Conflict, "the folder exists")
            .with_data(serde_json::json!({"path": req.dir_name})));
    }
    std::fs::create_dir(&dir)?;
    let made = (|| -> AppResult<ClassEntry> {
        std::fs::create_dir(dir.join(".tramado"))?;
        let entry = ClassEntry::new(&req.class_id, dir.clone());
        shared.registry.insert(entry.clone())?;
        Ok(entry)
    })();
    match made {
        Ok(entry) => Ok(CreatedClass {
            warnings: if is_cloud_folder(&dir) {
                vec![CreateWarning::CloudFolder]
            } else {
                Vec::new()
            },
            entry: ClassEntryView::of(entry),
        }),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn class_create(
    shared: State<'_, Shared>,
    req: CreateClassRequest,
) -> AppResult<CreatedClass> {
    let shared = shared.inner().clone();
    blocking(move || create_class(&shared, &req)).await
}

/// Registers an existing class folder; `foreignMembers` when `.tramado/members/` holds files
/// of devices other than this one (TS then forks it, sync spec §17).
pub fn adopt_class(shared: &Shared, dir: &Path) -> AppResult<AdoptedClass> {
    let class_json = confine::confine(dir, ".tramado/class.json")?;
    let bytes = files::read_optional(&class_json)?
        .ok_or_else(|| AppError::not_found("not a Tramado class folder"))?;
    let v: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new(Code::UnsupportedFile, "class.json is unreadable"))?;
    let class_id = v
        .get("classId")
        .and_then(|c| c.as_str())
        .filter(|c| ids::is_class_id(c))
        .ok_or_else(|| AppError::new(Code::UnsupportedFile, "class.json has no class id"))?
        .to_string();
    let me = shared.fs.device();
    let members = dir.join(".tramado").join("members");
    let foreign_members = std::fs::read_dir(&members)
        .map(|it| {
            it.flatten().any(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let stem = name.strip_suffix(".json").unwrap_or(&name);
                !files::is_skipped_name(&name) && me.as_deref() != Some(stem)
            })
        })
        .unwrap_or(false);
    shared
        .registry
        .insert(ClassEntry::new(&class_id, dir.to_path_buf()))?;
    let entry = entry_of(shared, &class_id)?;
    Ok(AdoptedClass {
        entry: ClassEntryView::of(entry),
        foreign_members,
    })
}

#[tauri::command]
pub async fn class_adopt(shared: State<'_, Shared>, pick: String) -> AppResult<AdoptedClass> {
    let dir = shared.picks.resolve(&pick, PickKind::Folder)?;
    let shared = shared.inner().clone();
    blocking(move || adopt_class(&shared, &dir)).await
}

/// After TS wrote the forked `class.json` (folder spec §8.1): the registry takes the new ID
/// (the old one stays as an alias), the private folder moves, and the old mirror is purged
/// (the files it guarded now belong to a new class).
pub fn fork_class(
    shared: &Shared,
    class_id: &str,
    new_class_id: &str,
) -> AppResult<ClassEntryView> {
    if !ids::is_class_id(new_class_id) {
        return Err(AppError::invalid("bad class id"));
    }
    let e = entry_of(shared, class_id)?;
    if e.shared || e.joining {
        return Err(AppError::new(
            Code::Conflict,
            "a shared class cannot be forked; leave it first",
        ));
    }
    let class_json = confine::confine(&e.path, ".tramado/class.json")?;
    let carried = files::read_optional(&class_json)?
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| {
            v.get("classId")
                .and_then(|c| c.as_str())
                .map(str::to_string)
        });
    if carried.as_deref() != Some(new_class_id) {
        return Err(AppError::new(
            Code::Conflict,
            "class.json does not carry the new class id",
        ));
    }
    let old_private = shared.paths.private_dir(&e.class_id);
    let new_private = shared.paths.private_dir(new_class_id);
    shared.registry.rename_id(&e.class_id, new_class_id)?;
    if old_private.is_dir() {
        if new_private.exists() {
            log::warn!("private data of {new_class_id} exists; the old one stays in place");
        } else if let Err(err) = std::fs::rename(&old_private, &new_private) {
            log::warn!("cannot move the private data of a forked class: {err}");
        }
    }
    files::remove_dir_all_if_exists(&new_private.join("mirror"))?;
    files::remove_dir_all_if_exists(&old_private.join("mirror"))?;
    Ok(ClassEntryView::of(entry_of(shared, new_class_id)?))
}

#[tauri::command]
pub async fn class_fork(
    shared: State<'_, Shared>,
    class_id: String,
    new_class_id: String,
) -> AppResult<ClassEntryView> {
    let shared = shared.inner().clone();
    blocking(move || fork_class(&shared, &class_id, &new_class_id)).await
}

#[tauri::command]
pub async fn class_update(
    shared: State<'_, Shared>,
    class_id: String,
    patch: ClassPatch,
) -> AppResult<ClassEntryView> {
    for p in patch
        .local_ignores
        .iter()
        .chain(patch.local_includes.iter())
        .flatten()
    {
        confine::validate_class_path(p)?;
    }
    let registry = shared.registry.clone();
    blocking(move || {
        let e = registry.update(&class_id, |e| {
            if let Some(a) = patch.archived {
                e.archived = a;
            }
            if let Some(s) = patch.skip_audio {
                e.skip_audio = s;
            }
            if let Some(l) = patch.local_ignores {
                e.local_ignores = l;
            }
            if let Some(l) = patch.local_includes {
                e.local_includes = l;
            }
        })?;
        Ok(ClassEntryView::of(e))
    })
    .await
}

fn not_shared(e: &ClassEntry) -> AppResult<()> {
    if e.shared || e.joining {
        return Err(AppError::new(
            Code::Conflict,
            "the class is shared: leave it first",
        ));
    }
    Ok(())
}

/// Unregisters (and so unwatches) a class; its files stay.
#[tauri::command]
pub async fn class_forget(shared: State<'_, Shared>, class_id: String) -> AppResult<()> {
    let e = entry_of(&shared, &class_id)?;
    not_shared(&e)?;
    let registry = shared.registry.clone();
    blocking(move || registry.remove(&e.class_id)).await
}

/// Moves the class folder to the OS trash, then forgets it.
#[tauri::command]
pub async fn class_trash(shared: State<'_, Shared>, class_id: String) -> AppResult<()> {
    let e = entry_of(&shared, &class_id)?;
    not_shared(&e)?;
    let registry = shared.registry.clone();
    blocking(move || {
        if std::fs::symlink_metadata(&e.path).is_ok() {
            trash::delete(&e.path).map_err(|err| {
                AppError::new(
                    Code::IoError,
                    format!("cannot move the class to the trash: {err}"),
                )
            })?;
        }
        registry.remove(&e.class_id)
    })
    .await
}

/// Empties `<root>/.stversions` (the class's 30-day trashcan on this computer).
#[tauri::command]
pub async fn class_trash_empty(shared: State<'_, Shared>, class_id: String) -> AppResult<()> {
    let e = entry_of(&shared, &class_id)?;
    blocking(move || {
        let versions = e.path.join(".stversions");
        match std::fs::symlink_metadata(&versions) {
            Ok(m) if m.file_type().is_symlink() => Err(AppError::new(
                Code::SymlinkRefused,
                "a symbolic link is in the way",
            )),
            Ok(_) => files::remove_dir_all_if_exists(&versions).map(|_| ()),
            Err(_) => Ok(()),
        }
    })
    .await
}

#[tauri::command]
pub async fn class_list(
    shared: State<'_, Shared>,
    class_id: String,
    dir: String,
    opts: ListOpts,
) -> AppResult<Vec<FileEntry>> {
    let fs = shared.fs.clone();
    let o = ListOptions {
        recursive: opts.recursive,
        max_depth: opts
            .max_depth
            .map(|d| d as usize)
            .unwrap_or(files::MAX_LIST_DEPTH),
        include_tramado: opts.include_tramado.unwrap_or(false),
        max_entries: files::MAX_LIST_ENTRIES,
    };
    blocking(move || fs.list(&class_id, &dir, o)).await
}

#[tauri::command]
pub async fn class_stat(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
) -> AppResult<Option<FileEntry>> {
    let fs = shared.fs.clone();
    blocking(move || fs.stat(&class_id, &path)).await
}

#[tauri::command]
pub async fn class_read(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
) -> AppResult<Response> {
    let fs = shared.fs.clone();
    blocking(move || fs.read(&class_id, &path).map(bytes_response)).await
}

#[tauri::command]
pub async fn class_read_range(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
    offset: u64,
    length: u64,
) -> AppResult<Response> {
    let fs = shared.fs.clone();
    blocking(move || {
        fs.read_range(&class_id, &path, offset, length)
            .map(bytes_response)
    })
    .await
}

/// Raw body; headers `x-class`, `x-path`, `x-own`.
#[tauri::command]
pub async fn class_write(shared: State<'_, Shared>, request: Request<'_>) -> AppResult<FileStamp> {
    let class = header(&request, "x-class")?;
    let path = header(&request, "x-path")?;
    let own = header_flag(&request, "x-own")?;
    let bytes = body_bytes(&request)?;
    let fs = shared.fs.clone();
    blocking(move || fs.write(&class, &path, &bytes, own)).await
}

/// Raw body (one line incl. `\n`); headers `x-class`, `x-path`, `x-own`.
#[tauri::command]
pub async fn class_append(shared: State<'_, Shared>, request: Request<'_>) -> AppResult<FileStamp> {
    let class = header(&request, "x-class")?;
    let path = header(&request, "x-path")?;
    let own = header_flag(&request, "x-own")?;
    let line = body_bytes(&request)?;
    let fs = shared.fs.clone();
    blocking(move || fs.append(&class, &path, &line, own)).await
}

#[tauri::command]
pub async fn class_mkdir(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
) -> AppResult<()> {
    let fs = shared.fs.clone();
    blocking(move || fs.mkdir(&class_id, &path)).await
}

#[tauri::command]
pub async fn class_move(
    shared: State<'_, Shared>,
    class_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let fs = shared.fs.clone();
    blocking(move || fs.rename(&class_id, &from, &to)).await
}

/// The observer (tramado-sync) records own deletions for the mass-delete guard.
#[tauri::command]
pub async fn class_remove(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
    recursive: bool,
) -> AppResult<()> {
    let fs = shared.fs.clone();
    blocking(move || fs.remove(&class_id, &path, recursive)).await
}

#[tauri::command]
pub async fn class_hash(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
) -> AppResult<String> {
    let fs = shared.fs.clone();
    blocking(move || fs.hash(&class_id, &path)).await
}

/// Copies a picked file into the class (staged, then placed; `CONFLICT` if `dest` exists).
#[tauri::command]
pub async fn class_import(
    shared: State<'_, Shared>,
    class_id: String,
    pick: String,
    dest: String,
) -> AppResult<FileStamp> {
    let src = shared.picks.resolve(&pick, PickKind::Open)?;
    let fs = shared.fs.clone();
    blocking(move || {
        let mut input = std::fs::File::open(&src)?;
        if !input.metadata()?.is_file() {
            return Err(AppError::invalid("only files can be imported"));
        }
        fs.stage_and_place(
            &class_id,
            &dest,
            |out| {
                std::io::copy(&mut input, out)?;
                Ok(())
            },
            false,
        )
    })
    .await
}

/// Copies a class file to the place the person chose in a save dialog.
#[tauri::command]
pub async fn class_export(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
    pick: String,
) -> AppResult<()> {
    let dest = shared.picks.resolve(&pick, PickKind::Save)?;
    let src = class_abs(&shared, &class_id, &path)?;
    blocking(move || {
        if !std::fs::symlink_metadata(&src)?.is_file() {
            return Err(AppError::invalid("only files can be exported"));
        }
        std::fs::copy(&src, &dest)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn class_reveal(
    app: AppHandle,
    shared: State<'_, Shared>,
    class_id: String,
    path: Option<String>,
) -> AppResult<()> {
    let target = match path.as_deref() {
        Some(p) if !p.is_empty() => class_abs(&shared, &class_id, p)?,
        _ => entry_of(&shared, &class_id)?.path,
    };
    blocking(move || {
        app.opener()
            .reveal_item_in_dir(&target)
            .map_err(|e| AppError::new(Code::IoError, format!("cannot show the file: {e}")))
    })
    .await
}

/// Extensions `class_open` refuses: a classmate could sync a program or a launcher into the
/// class, and "open with the system app" would run it.
const NOT_OPENED: &[&str] = &[
    "exe",
    "msi",
    "bat",
    "cmd",
    "com",
    "scr",
    "pif",
    "cpl",
    "msc",
    "lnk",
    "url",
    "reg",
    "hta",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "jar",
    "app",
    "command",
    "tool",
    "workflow",
    "terminal",
    "sh",
    "bash",
    "zsh",
    "csh",
    "ksh",
    "run",
    "bin",
    "appimage",
    "desktop",
    "deb",
    "rpm",
    "dmg",
    "pkg",
    "mpkg",
    "py",
    "pyw",
    "pl",
    "rb",
    "php",
    "scpt",
    "applescript",
    "inf",
    "sys",
    "dll",
    "so",
    "dylib",
    "action",
    "ade",
    "adp",
    "chm",
    "gadget",
    "msp",
    "mst",
    "xbap",
    "application",
    "settingcontent-ms",
    "library-ms",
    "searchconnector-ms",
];

pub fn may_open(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((_, ext)) => !NOT_OPENED.contains(&ext.to_ascii_lowercase().as_str()),
        None => false,
    }
}

/// Opens a class file with the system app (`INVALID` for programs and launchers).
#[tauri::command]
pub async fn class_open(
    app: AppHandle,
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
) -> AppResult<()> {
    if !may_open(&path) {
        return Err(AppError::invalid(
            "this kind of file is not opened from a class",
        ));
    }
    let target = class_abs(&shared, &class_id, &path)?;
    blocking(move || {
        if !std::fs::symlink_metadata(&target)?.is_file() {
            return Err(AppError::not_found("no such file"));
        }
        app.opener()
            .open_path(target.to_string_lossy(), None::<&str>)
            .map_err(|e| AppError::new(Code::IoError, format!("cannot open the file: {e}")))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::app::tests::TempDir;
    use tramado_base::classfs::ClassFs;
    use tramado_base::paths::Paths;
    use tramado_base::picks::PickRegistry;
    use tramado_base::registry::ClassRegistry;

    const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ME: &str = "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";
    const OTHER: &str = "BBBBBBB-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";

    fn shared(dir: &Path) -> Shared {
        let paths = Arc::new(Paths::for_tests(dir));
        let registry = Arc::new(ClassRegistry::load(&paths.config).unwrap());
        let fs = Arc::new(ClassFs::new(paths.clone(), registry.clone()));
        Shared {
            paths,
            registry,
            fs,
            picks: Arc::new(PickRegistry::new()),
            version: "0.1.0".into(),
        }
    }

    #[test]
    fn create_registers_and_warns_for_cloud_folders() {
        let dir = TempDir::new();
        let s = shared(dir.path());
        let req = |id: &str, name: &str| CreateClassRequest {
            class_id: id.into(),
            dir_name: name.into(),
            parent: None,
        };
        let c = create_class(&s, &req(CLASS, "Direito Civil")).unwrap();
        let root = dir.path().join("classes").join("Direito Civil");
        assert!(root.join(".tramado").is_dir());
        assert_eq!(c.entry.dir_name, "Direito Civil");
        assert!(!c.entry.entry.shared);
        assert!(c.warnings.is_empty());
        assert_eq!(
            create_class(&s, &req(CLASS, "Outra")).unwrap_err().code(),
            Code::Conflict
        );
        assert_eq!(
            create_class(
                &s,
                &req("tramado-bbbbbbbbbbbbbbbbbbbbbbbbbb", "Direito Civil")
            )
            .unwrap_err()
            .code(),
            Code::Conflict
        );
        for bad in ["", "a/b", "..", ".stfolder", "x.tmp"] {
            assert_eq!(
                create_class(&s, &req("tramado-cccccccccccccccccccccccccc", bad))
                    .unwrap_err()
                    .code(),
                Code::Invalid,
                "{bad}"
            );
        }
        assert_eq!(
            child_names(&dir.path().join("classes")),
            vec!["Direito Civil"]
        );
        // A cloud folder is created, with a warning.
        let cloud = dir.path().join("OneDrive - Universidade");
        std::fs::create_dir_all(&cloud).unwrap();
        let pick = s.picks.register(&cloud, PickKind::Folder);
        let c = create_class(
            &s,
            &CreateClassRequest {
                class_id: "tramado-dddddddddddddddddddddddddd".into(),
                dir_name: "Bio".into(),
                parent: Some(pick.token),
            },
        )
        .unwrap();
        assert_eq!(c.warnings, vec![CreateWarning::CloudFolder]);
        assert!(is_cloud_folder(Path::new(
            "/Users/a/Library/Mobile Documents/x"
        )));
        assert!(!is_cloud_folder(Path::new("/home/a/Tramado")));
    }

    #[test]
    fn adopt_reads_class_id_and_foreign_members() {
        let dir = TempDir::new();
        let s = shared(dir.path());
        s.fs.set_device(ME);
        let folder = dir.path().join("Copied");
        std::fs::create_dir_all(folder.join(".tramado/members")).unwrap();
        assert_eq!(adopt_class(&s, &folder).unwrap_err().code(), Code::NotFound);
        std::fs::write(
            folder.join(".tramado/class.json"),
            format!(r#"{{"format":"tramado.class","version":1,"classId":"{CLASS}"}}"#),
        )
        .unwrap();
        std::fs::write(folder.join(format!(".tramado/members/{ME}.json")), b"{}").unwrap();
        let a = adopt_class(&s, &folder).unwrap();
        assert_eq!(a.entry.entry.class_id, CLASS);
        assert!(a.entry.available);
        assert!(!a.foreign_members);
        assert_eq!(adopt_class(&s, &folder).unwrap_err().code(), Code::Conflict);
        s.registry.remove(CLASS).unwrap();
        std::fs::write(folder.join(format!(".tramado/members/{OTHER}.json")), b"{}").unwrap();
        assert!(adopt_class(&s, &folder).unwrap().foreign_members);
    }

    #[test]
    fn fork_renames_and_moves_private_data() {
        let dir = TempDir::new();
        let s = shared(dir.path());
        create_class(
            &s,
            &CreateClassRequest {
                class_id: CLASS.into(),
                dir_name: "Física".into(),
                parent: None,
            },
        )
        .unwrap();
        let new_id = "tramado-eeeeeeeeeeeeeeeeeeeeeeeeee";
        let root = dir.path().join("classes").join("Física");
        let old_private = s.paths.private_dir(CLASS);
        std::fs::create_dir_all(old_private.join("mirror")).unwrap();
        std::fs::write(old_private.join("trust.json"), b"{}").unwrap();
        // class.json does not carry the new ID yet.
        assert_eq!(
            fork_class(&s, CLASS, new_id).unwrap_err().code(),
            Code::Conflict
        );
        std::fs::write(
            root.join(".tramado/class.json"),
            format!(r#"{{"classId":"{new_id}"}}"#),
        )
        .unwrap();
        let v = fork_class(&s, CLASS, new_id).unwrap();
        assert_eq!(v.entry.class_id, new_id);
        assert_eq!(v.entry.aliases, vec![CLASS.to_string()]);
        let new_private = s.paths.private_dir(new_id);
        assert!(new_private.join("trust.json").is_file());
        assert!(!new_private.join("mirror").exists());
        assert!(!old_private.exists());
        // A shared class cannot be forked.
        s.registry.update(new_id, |e| e.shared = true).unwrap();
        assert_eq!(
            fork_class(&s, new_id, "tramado-ffffffffffffffffffffffffff")
                .unwrap_err()
                .code(),
            Code::Conflict
        );
    }

    #[test]
    fn programs_are_not_opened() {
        for ok in [
            "Docs/Código Civil.pdf",
            "a.md",
            "Aulas/x/audio.webm",
            "notes.TXT",
        ] {
            assert!(may_open(ok), "{ok}");
        }
        for bad in [
            "setup.exe",
            "Docs/run.SH",
            "x.desktop",
            "a.AppImage",
            "noext",
            "a.lnk",
            "b.js",
        ] {
            assert!(!may_open(bad), "{bad}");
        }
    }
}
