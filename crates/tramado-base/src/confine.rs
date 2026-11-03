// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Class path rules and confinement (architecture §5.1 `confine`, folder spec §1, §4.5, §5.4).
//! The rules are shared with `app/src/core/model/paths.ts` through
//! `test-vectors/class-paths.json`.
//!
//! Every class operation goes through [`confine`]: a registered class root, a valid class path,
//! and no symlink on any existing component (Syncthing syncs symlinks on Unix, so a classmate
//! could plant `notes.md -> ~/.ssh/id_rsa`; `std::fs` follows links).

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult, Code};

/// Folder spec §4.6: a class path is at most 200 UTF-16 code units.
pub const MAX_CLASS_PATH_UNITS: usize = 200;

/// Where large new files are staged (folder spec §4.4); the only place `*.tmp`/`*.part` may be.
pub const STAGING_PREFIX: &str = ".tramado/tmp/";

fn bad(why: &str) -> AppError {
    // The path itself is not echoed: it could be anything the webview was handed.
    AppError::new(Code::Invalid, format!("bad class path: {why}"))
}

fn ends_with_ci(s: &str, suffix: &str) -> bool {
    s.len() >= suffix.len()
        && s.is_char_boundary(s.len() - suffix.len())
        && s[s.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

/// `INVALID` unless `rel` is a class path Tramado may touch: non-empty, ≤ 200 UTF-16 units,
/// `/`-separated, no leading `/`, no `\`, no C0 control or DEL (NUL included), no empty, `.` or
/// `..` segment, no segment starting with `.st` (`.stfolder`, `.stignore`, `.stversions`), and
/// no `*.tmp`/`*.part` segment unless under `.tramado/tmp/`. (NFC is the webview's job: Rust's
/// standard library cannot normalise.)
pub fn validate_class_path(rel: &str) -> AppResult<()> {
    if rel.is_empty() {
        return Err(bad("empty"));
    }
    if rel.encode_utf16().count() > MAX_CLASS_PATH_UNITS {
        return Err(bad("longer than 200 UTF-16 units"));
    }
    if rel.starts_with('/') {
        return Err(bad("absolute"));
    }
    if rel.contains('\\') {
        return Err(bad("backslash"));
    }
    // C0 controls and DEL, exactly as `core/model/paths.ts` (C1 controls are allowed in names).
    if rel.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}') {
        return Err(bad("control character"));
    }
    let staged = rel.starts_with(STAGING_PREFIX) && rel.len() > STAGING_PREFIX.len();
    for seg in rel.split('/') {
        if seg.is_empty() {
            return Err(bad("empty segment"));
        }
        if seg == "." || seg == ".." {
            return Err(bad("dot segment"));
        }
        if seg.starts_with(".st") {
            return Err(bad("Syncthing name"));
        }
        if !staged && (ends_with_ci(seg, ".tmp") || ends_with_ci(seg, ".part")) {
            return Err(bad("temporary name"));
        }
    }
    Ok(())
}

/// Validates `rel` and resolves it under `root`, refusing a symlink on every existing
/// component (`SYMLINK_REFUSED`). The result is `root.join(rel)`, never canonicalised through
/// links; `PATH_OUTSIDE_CLASS` if a segment would not stay a plain name under `root` (a Windows
/// drive prefix, for instance).
pub fn confine(root: &Path, rel: &str) -> AppResult<PathBuf> {
    validate_class_path(rel)?;
    let mut cur = root.to_path_buf();
    let mut exists = true;
    for seg in rel.split('/') {
        let mut comps = Path::new(seg).components();
        match (comps.next(), comps.next()) {
            (Some(Component::Normal(n)), None) if n == seg => {}
            _ => {
                return Err(AppError::new(
                    Code::PathOutsideClass,
                    "class path leaves the class folder",
                ))
            }
        }
        cur.push(seg);
        if exists {
            match std::fs::symlink_metadata(&cur) {
                Ok(m) if m.file_type().is_symlink() => {
                    return Err(AppError::new(
                        Code::SymlinkRefused,
                        "a symbolic link is in the way",
                    ));
                }
                Ok(_) => {}
                // The rest does not exist yet (or cannot be read): the operation itself reports it.
                Err(_) => exists = false,
            }
        }
    }
    if !cur.starts_with(root) {
        return Err(AppError::new(
            Code::PathOutsideClass,
            "class path leaves the class folder",
        ));
    }
    Ok(cur)
}

/// The class path of `abs` under `root` (`/`-separated), if it is inside and valid UTF-8.
pub fn class_path_of(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(n) => parts.push(n.to_str()?),
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules() {
        for ok in [
            "Aulas/2026-10-14 1015 Aula 6/lecture.json",
            ".tramado/chat/AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2/2026-11.jsonl",
            "Documentos/Código Civil.pdf",
            ".tramado/tmp/x1y2.part",
            "Notas/a b.md",
            "a.sync-conflict-20261103-101500-AB4Z76W.md",
        ] {
            assert!(validate_class_path(ok).is_ok(), "{ok}");
        }
        let long = "a".repeat(201);
        for bad in [
            "",
            "/abs",
            "a//b",
            "a/./b",
            "../x",
            "a/../b",
            "a\\b",
            "a\u{0}b",
            ".stfolder/x",
            "x/.stignore",
            ".stversions/a",
            "Docs/a.tmp",
            "Docs/a.part",
            &long,
            "a/",
            "a\u{7}b",
            ".tramado/tmp/",
            ".tramado/tmpx/a.part",
        ] {
            let e = validate_class_path(bad).unwrap_err();
            assert_eq!(e.code(), Code::Invalid, "{bad:?}");
        }
        // 200 UTF-16 units is the limit; "𝄞" counts as two.
        assert!(validate_class_path(&"a".repeat(200)).is_ok());
        assert!(validate_class_path(&format!("{}𝄞", "a".repeat(198))).is_ok());
        assert!(validate_class_path(&format!("{}𝄞", "a".repeat(199))).is_err());
    }

    #[test]
    fn confines_and_refuses_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("class");
        std::fs::create_dir_all(root.join("Docs")).unwrap();
        assert_eq!(
            confine(&root, "Docs/a.pdf").unwrap(),
            root.join("Docs").join("a.pdf")
        );
        assert_eq!(
            confine(&root, "New/b/c.md").unwrap(),
            root.join("New/b/c.md")
        );
        #[cfg(unix)]
        {
            let outside = dir.path().join("secret");
            std::fs::create_dir_all(&outside).unwrap();
            std::fs::write(outside.join("id_rsa"), b"x").unwrap();
            std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
            std::os::unix::fs::symlink(outside.join("id_rsa"), root.join("Docs/notes.md")).unwrap();
            assert_eq!(
                confine(&root, "link/id_rsa").unwrap_err().code(),
                Code::SymlinkRefused
            );
            assert_eq!(
                confine(&root, "Docs/notes.md").unwrap_err().code(),
                Code::SymlinkRefused
            );
            // A dangling link is refused too.
            std::os::unix::fs::symlink(dir.path().join("nowhere"), root.join("dangling")).unwrap();
            assert_eq!(
                confine(&root, "dangling").unwrap_err().code(),
                Code::SymlinkRefused
            );
        }
        assert_eq!(confine(&root, "../x").unwrap_err().code(), Code::Invalid);
    }

    #[test]
    fn class_path_of_maps_back() {
        let root = Path::new("/r/class");
        assert_eq!(
            class_path_of(root, Path::new("/r/class/a/b.md")).as_deref(),
            Some("a/b.md")
        );
        assert_eq!(class_path_of(root, Path::new("/r/other/b.md")), None);
        assert_eq!(class_path_of(root, root), None);
    }
}
