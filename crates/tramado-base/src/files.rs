// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/files.rs), MPL-2.0, same author.

//! Plain file operations used by the class file system and the app files (architecture §5.1
//! `files`, folder spec §4.4–§4.5): atomic whole-file writes, single-write appends, ranges,
//! listings that skip what a class reader must skip, and hashing.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult, Code};
use crate::ids;

/// Folder spec §4.4: a JSONL line is at most 65 536 bytes, `\n` included.
pub const MAX_LINE_BYTES: usize = 65_536;
/// Listings never go deeper than this.
pub const MAX_LIST_DEPTH: usize = 16;
/// Listings stop after this many entries.
pub const MAX_LIST_ENTRIES: usize = 50_000;

/// Modification time in ms since the epoch (0 when unknown).
pub fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// True for a temporary name of [`write_atomic`]: `.<name>.<8 [a-z0-9]>.tmp`.
pub fn is_atomic_tmp(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.').and_then(|n| n.strip_suffix(".tmp")) else {
        return false;
    };
    let Some((head, tail)) = rest.rsplit_once('.') else {
        return false;
    };
    !head.is_empty()
        && tail.len() == 8
        && tail
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
    // Makes a rename durable: without it a power cut can bring back the old file.
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// `fs::rename` over an existing file. On Windows the target can be open for a moment in a
/// process that did not allow deletion (Syncthing hashing it, a virus scanner, a preview): the
/// rename then fails with a sharing violation or access denied, so it is retried (seven attempts,
/// 0.63 s of waits in all) before the error is returned.
fn rename_replacing(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        // ERROR_ACCESS_DENIED (5), ERROR_SHARING_VIOLATION (32), ERROR_LOCK_VIOLATION (33).
        const BUSY: [i32; 3] = [5, 32, 33];
        let mut wait_ms = 10;
        loop {
            match fs::rename(from, to) {
                Err(e) if wait_ms <= 320 && e.raw_os_error().is_some_and(|c| BUSY.contains(&c)) => {
                    std::thread::sleep(std::time::Duration::from_millis(wait_ms));
                    wait_ms *= 2;
                }
                other => return other,
            }
        }
    }
    #[cfg(not(windows))]
    {
        fs::rename(from, to)
    }
}

fn parent_and_name(path: &Path) -> AppResult<(&Path, String)> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid("path has no parent folder"))?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::invalid("path has no file name"))?
        .to_string_lossy()
        .into_owned();
    Ok((parent, name))
}

/// Writes through a temporary file in the same folder (`.<name>.<8 random [a-z0-9]>.tmp`,
/// folder spec §4.4) and a rename, so a crash never leaves half a file and Syncthing never
/// sends the temporary file (`*.tmp` is in the managed ignores). Creates missing parents;
/// the temporary file is removed on failure; on Unix the folder is synced after the rename.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    write_atomic_with(path, |f| f.write_all(bytes).map_err(AppError::from), None)
}

/// [`write_atomic`] with a Unix file mode for the new file (e.g. `0o600` for secrets).
pub fn write_atomic_mode(path: &Path, bytes: &[u8], mode: u32) -> AppResult<()> {
    write_atomic_with(
        path,
        |f| f.write_all(bytes).map_err(AppError::from),
        Some(mode),
    )
}

fn write_atomic_with(
    path: &Path,
    fill: impl FnOnce(&mut fs::File) -> AppResult<()>,
    mode: Option<u32>,
) -> AppResult<()> {
    let (parent, name) = parent_and_name(path)?;
    fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(".{name}.{}.tmp", ids::random_lower_alnum(8)));
    let written = (|| -> AppResult<()> {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        if let Some(m) = mode {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(m);
        }
        #[cfg(not(unix))]
        let _ = mode;
        let mut f = opts.open(&tmp)?;
        fill(&mut f)?;
        f.sync_all()?;
        drop(f);
        // Rust's rename replaces an existing file on Windows too (MOVEFILE_REPLACE_EXISTING).
        rename_replacing(&tmp, path)?;
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    sync_dir(parent);
    Ok(())
}

/// Checks the JSONL line rules of folder spec §4.4: ends in `\n`, no other `\n`, at most
/// 65 536 bytes.
pub fn check_line(line: &[u8]) -> AppResult<()> {
    if line.last() != Some(&b'\n') {
        return Err(AppError::invalid("a line must end with a newline"));
    }
    if line[..line.len() - 1].contains(&b'\n') {
        return Err(AppError::invalid("a line must not contain another newline"));
    }
    if line.len() > MAX_LINE_BYTES {
        return Err(AppError::invalid("a line is longer than 65 536 bytes"));
    }
    Ok(())
}

/// Appends one JSONL line with a single `write` on a file opened with `O_APPEND`, then
/// `sync_data`. Creates the file and its parents. Returns the new length.
pub fn append_line(path: &Path, line: &[u8]) -> AppResult<u64> {
    check_line(line)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    f.write_all(line)?;
    f.sync_data()?;
    Ok(f.metadata()?.len())
}

pub fn read_optional(path: &Path) -> AppResult<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Up to `len` bytes from `offset` (fewer at the end of the file, none past it).
pub fn read_range(path: &Path, offset: u64, len: u64) -> AppResult<Vec<u8>> {
    let mut f = fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut out = Vec::new();
    f.take(len).read_to_end(&mut out)?;
    Ok(out)
}

/// Whether a missing path is fine, a removal that found nothing returns `false`.
pub fn remove_file_if_exists(path: &Path) -> AppResult<bool> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

pub fn remove_dir_all_if_exists(path: &Path) -> AppResult<bool> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// Streaming SHA-256 of a file (1 MiB buffer), lower-case hex.
pub fn sha256_file(path: &Path) -> AppResult<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(ids::hex_lower(&h.finalize()))
}

/// Removes this module's own temporary files (`.<name>.<8>.tmp`) in `dir` older than
/// `older_than` (a crash, a drive unplugged mid-write). Never touches other files. Returns how
/// many were removed.
pub fn sweep_stale_tmps(dir: &Path, older_than: Duration) -> AppResult<usize> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.into()),
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        if !is_atomic_tmp(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .filter(|m| m.is_file())
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > older_than);
        if stale && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListOptions {
    pub recursive: bool,
    /// ≤ 16
    pub max_depth: usize,
    pub include_tramado: bool,
    /// ≤ 50 000
    pub max_entries: usize,
}

impl Default for ListOptions {
    fn default() -> Self {
        ListOptions {
            recursive: false,
            max_depth: MAX_LIST_DEPTH,
            include_tramado: false,
            max_entries: MAX_LIST_ENTRIES,
        }
    }
}

/// One entry of a class listing (TS `ClassFileEntry`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// class path
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: u64,
    /// the class path of the original, for a `*.sync-conflict-*` copy
    pub conflict_of: Option<String>,
}

/// Names a class reader skips at any depth (folder spec §4.5), conflict copies excepted (they are
/// listed with `conflict_of`).
pub fn is_skipped_name(name: &str) -> bool {
    name == ".stfolder"
        || name == ".stversions"
        || name == ".stignore"
        || (name.starts_with(".syncthing.") && name.ends_with(".tmp"))
        || (name.starts_with("~syncthing~") && name.ends_with(".tmp"))
        || name.ends_with(".tmp")
        || name.ends_with(".part")
}

/// For a Syncthing conflict copy `<base>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ShortId>[.<ext>]`,
/// the name of the original (`<base>[.<ext>]`).
pub fn conflict_original(name: &str) -> Option<String> {
    let (base, rest) = name.split_once(".sync-conflict-")?;
    let b = rest.as_bytes();
    // YYYYMMDD-HHMMSS-XXXXXXX = 8 + 1 + 6 + 1 + 7 = 23 bytes
    if b.len() < 23
        || !b[..8].iter().all(u8::is_ascii_digit)
        || b[8] != b'-'
        || !b[9..15].iter().all(u8::is_ascii_digit)
        || b[15] != b'-'
        || !b[16..23].iter().all(|c| c.is_ascii_alphanumeric())
    {
        return None;
    }
    let ext = &rest[23..];
    if base.is_empty() || !(ext.is_empty() || ext.starts_with('.')) {
        return None;
    }
    Some(format!("{base}{ext}"))
}

/// Lists `dir` (a folder inside the class `root`) as class paths, sorted by name. Never follows
/// links (links are left out); skips folder spec §4.5 names and `.tramado/tmp`; skips other dot
/// names unless they are `.tramado` or inside it and `include_tramado` is set. `NOT_FOUND` for a
/// missing folder.
pub fn list(root: &Path, dir: &Path, opts: ListOptions) -> AppResult<Vec<FileEntry>> {
    match fs::symlink_metadata(dir) {
        Ok(m) if m.is_dir() => {}
        Ok(m) if m.file_type().is_symlink() => {
            return Err(AppError::new(
                Code::SymlinkRefused,
                "a symbolic link is in the way",
            ))
        }
        Ok(_) => return Err(AppError::invalid("not a folder")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::not_found("no such folder"))
        }
        Err(e) => return Err(e.into()),
    }
    let max_depth = if opts.recursive {
        opts.max_depth.clamp(1, MAX_LIST_DEPTH)
    } else {
        1
    };
    let max_entries = opts.max_entries.clamp(1, MAX_LIST_ENTRIES);
    let staging = root.join(".tramado").join("tmp");
    let in_tramado_dir = dir
        .strip_prefix(root)
        .ok()
        .is_some_and(|r| r.starts_with(".tramado"));
    let walker = walkdir::WalkDir::new(dir)
        .min_depth(1)
        .max_depth(max_depth)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if is_skipped_name(&name) || e.path() == staging {
                return false;
            }
            if name.starts_with('.') {
                let inside = in_tramado_dir
                    || e.path()
                        .strip_prefix(root)
                        .ok()
                        .is_some_and(|r| r.starts_with(".tramado"));
                return opts.include_tramado && inside;
            }
            true
        });
    let mut out = Vec::new();
    for entry in walker {
        let Ok(entry) = entry else { continue }; // unreadable entries are skipped, not fatal
        if entry.file_type().is_symlink() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Some(path) = crate::confine::class_path_of(root, entry.path()) else {
            continue;
        };
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let conflict_of = conflict_original(&name).map(|orig| match path.rsplit_once('/') {
            Some((parent, _)) => format!("{parent}/{orig}"),
            None => orig,
        });
        out.push(FileEntry {
            path,
            name,
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            mtime_ms: mtime_ms(&meta),
            conflict_of,
        });
        if out.len() >= max_entries {
            break;
        }
    }
    Ok(out)
}

/// Total size of the regular files under `dir` (links not followed; missing → 0).
pub fn dir_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

/// `path` joined under `base` from `/`-separated `rel` (no validation: callers confine first).
pub fn join_rel(base: &Path, rel: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for seg in rel.split('/') {
        p.push(seg);
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_names_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("Inês — notas 日本.txt");
        write_atomic(&p, b"hello").unwrap();
        write_atomic(&p, b"hello again").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"hello again");
        let left: Vec<_> = fs::read_dir(dir.path().join("sub")).unwrap().collect();
        assert_eq!(left.len(), 1, "no temporary file is left behind");
        // A failed write removes its temporary file: the target is a folder.
        fs::create_dir_all(dir.path().join("sub").join("folder")).unwrap();
        assert!(write_atomic(&dir.path().join("sub").join("folder"), b"x").is_err());
        let names: Vec<String> = fs::read_dir(dir.path().join("sub"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.ends_with(".tmp")), "{names:?}");
        assert!(is_atomic_tmp(".lecture.json.ab12cd34.tmp"));
        assert!(!is_atomic_tmp(".lecture.json.AB12CD34.tmp"));
        assert!(!is_atomic_tmp(".lecture.json.ab12cd3.tmp"));
        assert!(!is_atomic_tmp("lecture.json.ab12cd34.tmp"));
        assert!(!is_atomic_tmp(".ab12cd34.tmp"));
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_with_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("secrets.json");
        write_atomic_mode(&p, b"{}", 0o600).unwrap();
        assert_eq!(
            fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn stale_temporary_files_are_swept() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join(".a.json.abcd1234.tmp");
        let fresh = dir.path().join(".b.json.abcd1234.tmp");
        let other = dir.path().join(".hidden.tmp");
        for p in [&old, &fresh, &other] {
            fs::write(p, b"x").unwrap();
        }
        let two_hours_ago = std::time::SystemTime::now() - Duration::from_secs(7200);
        for p in [&old, &other] {
            fs::File::options()
                .write(true)
                .open(p)
                .unwrap()
                .set_modified(two_hours_ago)
                .unwrap();
        }
        assert_eq!(
            sweep_stale_tmps(dir.path(), Duration::from_secs(3600)).unwrap(),
            1
        );
        assert!(!old.exists());
        assert!(fresh.exists());
        assert!(other.exists(), "files of another shape are never touched");
        assert_eq!(
            sweep_stale_tmps(&dir.path().join("missing"), Duration::ZERO).unwrap(),
            0
        );
    }

    #[test]
    fn append_line_rules() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("chat").join("2026-11.jsonl");
        assert_eq!(append_line(&p, b"{\"a\":1}\n").unwrap(), 8);
        assert_eq!(append_line(&p, b"{\"b\":2}\n").unwrap(), 16);
        assert_eq!(fs::read(&p).unwrap(), b"{\"a\":1}\n{\"b\":2}\n");
        for bad in [&b"no newline"[..], b"two\nlines\n", b""] {
            assert_eq!(append_line(&p, bad).unwrap_err().code(), Code::Invalid);
        }
        let mut max = vec![b'x'; MAX_LINE_BYTES - 1];
        max.push(b'\n');
        assert!(append_line(&p, &max).is_ok());
        let mut over = vec![b'x'; MAX_LINE_BYTES];
        over.push(b'\n');
        assert_eq!(append_line(&p, &over).unwrap_err().code(), Code::Invalid);
    }

    #[test]
    fn ranges_hashes_and_removal() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        fs::write(&p, b"0123456789").unwrap();
        assert_eq!(read_range(&p, 2, 3).unwrap(), b"234");
        assert_eq!(read_range(&p, 8, 100).unwrap(), b"89");
        assert!(read_range(&p, 50, 4).unwrap().is_empty());
        assert_eq!(
            sha256_file(&p).unwrap(),
            "84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882"
        );
        assert_eq!(read_optional(&dir.path().join("none")).unwrap(), None);
        assert!(remove_file_if_exists(&p).unwrap());
        assert!(!remove_file_if_exists(&p).unwrap());
        fs::create_dir_all(dir.path().join("d/e")).unwrap();
        assert!(remove_dir_all_if_exists(&dir.path().join("d")).unwrap());
        assert!(!remove_dir_all_if_exists(&dir.path().join("d")).unwrap());
    }

    #[test]
    fn conflict_names() {
        assert_eq!(
            conflict_original("Notas.sync-conflict-20261103-101500-AB4Z76W.md").as_deref(),
            Some("Notas.md")
        );
        assert_eq!(
            conflict_original("README.sync-conflict-20261103-101500-AB4Z76W").as_deref(),
            Some("README")
        );
        assert_eq!(conflict_original("a.sync-conflict-2026-x.md"), None);
        assert_eq!(conflict_original("plain.md"), None);
    }

    #[test]
    fn listing_skips_what_readers_skip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for f in [
            "Docs/a.pdf",
            "Docs/b.md",
            "Docs/b.sync-conflict-20261103-101500-AB4Z76W.md",
            "Docs/x.tmp",
            "Docs/y.part",
            "Docs/.hidden",
            ".stversions/Docs/a.pdf",
            ".tramado/class.json",
            ".tramado/tmp/z.part",
            ".tramado/tmp/zz",
            ".tramado/members/.dot",
            ".stignore",
        ] {
            let p = join_rel(root, f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, b"x").unwrap();
        }
        fs::create_dir_all(root.join(".stfolder")).unwrap();
        let rec = |include_tramado| ListOptions {
            recursive: true,
            include_tramado,
            ..ListOptions::default()
        };
        let paths: Vec<String> = list(root, root, rec(false))
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(
            paths,
            vec![
                "Docs",
                "Docs/a.pdf",
                "Docs/b.md",
                "Docs/b.sync-conflict-20261103-101500-AB4Z76W.md"
            ]
        );
        let with: Vec<FileEntry> = list(root, root, rec(true)).unwrap();
        let paths: Vec<&str> = with.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                ".tramado",
                ".tramado/class.json",
                ".tramado/members",
                ".tramado/members/.dot",
                "Docs",
                "Docs/a.pdf",
                "Docs/b.md",
                "Docs/b.sync-conflict-20261103-101500-AB4Z76W.md"
            ]
        );
        let conflict = with
            .iter()
            .find(|e| e.name.contains("sync-conflict"))
            .unwrap();
        assert_eq!(conflict.conflict_of.as_deref(), Some("Docs/b.md"));
        let top: Vec<String> = list(root, root, ListOptions::default())
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(top, vec!["Docs"]);
        let inside: Vec<String> = list(root, &root.join(".tramado"), rec(true))
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(
            inside,
            vec![
                ".tramado/class.json",
                ".tramado/members",
                ".tramado/members/.dot"
            ]
        );
        let capped = list(
            root,
            root,
            ListOptions {
                max_entries: 2,
                ..rec(false)
            },
        )
        .unwrap();
        assert_eq!(capped.len(), 2);
        assert_eq!(
            list(root, &root.join("nope"), rec(false))
                .unwrap_err()
                .code(),
            Code::NotFound
        );
        let e = &list(root, &root.join("Docs"), ListOptions::default()).unwrap()[0];
        assert_eq!((e.name.as_str(), e.is_dir, e.size), ("a.pdf", false, 1));
        assert!(e.mtime_ms > 0);
    }
}
