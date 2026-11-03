// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/error.rs), MPL-2.0, same author.

//! Errors crossing the IPC boundary (architecture §15). The UI switches on `code`;
//! `message` is for logs only and never contains class content.

use serde::{Deserialize, Serialize};

/// Every error code of architecture §15, in the order of `test-vectors/error-codes.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Code {
    // common
    Invalid,
    NotFound,
    PermissionDenied,
    IoError,
    DiskFull,
    Cancelled,
    JobBusy,
    PathOutsideClass,
    SymlinkRefused,
    Conflict,
    NewerFormat,
    UnsupportedFile,
    NotImplemented,
    // AI
    AiNoKey,
    AiAuth,
    AiNoCredit,
    AiModelGated,
    AiFlagged,
    AiPrivacyBlocks,
    AiUnsupported,
    AiModelUnknown,
    AiTooLong,
    AiBadRequest,
    AiBusy,
    AiFreeLimit,
    AiUpstream,
    AiUnavailable,
    AiTimeout,
    AiOffline,
    AiLength,
    AiHostNotAllowed,
    AiBadAddress,
    // speech
    SpeechNoDevice,
    SpeechPermission,
    SpeechNoSystemAudio,
    SpeechUnsupportedAudio,
    SpeechNoSpeech,
    SpeechUnsupportedCpu,
    ModelNotDownloaded,
    ModelUnreadable,
    ModelDownloadFailed,
    ModelIntegrity,
    // sync
    SyncUnavailable,
    SyncLocked,
    SyncPort,
    SyncFolderMarkerMissing,
    SyncInviteInvalid,
    SyncForeignWrite,
    SyncIdentityCopied,
}

impl Code {
    /// Every code, in the order of architecture §15.
    pub const ALL: [Code; 49] = [
        Code::Invalid,
        Code::NotFound,
        Code::PermissionDenied,
        Code::IoError,
        Code::DiskFull,
        Code::Cancelled,
        Code::JobBusy,
        Code::PathOutsideClass,
        Code::SymlinkRefused,
        Code::Conflict,
        Code::NewerFormat,
        Code::UnsupportedFile,
        Code::NotImplemented,
        Code::AiNoKey,
        Code::AiAuth,
        Code::AiNoCredit,
        Code::AiModelGated,
        Code::AiFlagged,
        Code::AiPrivacyBlocks,
        Code::AiUnsupported,
        Code::AiModelUnknown,
        Code::AiTooLong,
        Code::AiBadRequest,
        Code::AiBusy,
        Code::AiFreeLimit,
        Code::AiUpstream,
        Code::AiUnavailable,
        Code::AiTimeout,
        Code::AiOffline,
        Code::AiLength,
        Code::AiHostNotAllowed,
        Code::AiBadAddress,
        Code::SpeechNoDevice,
        Code::SpeechPermission,
        Code::SpeechNoSystemAudio,
        Code::SpeechUnsupportedAudio,
        Code::SpeechNoSpeech,
        Code::SpeechUnsupportedCpu,
        Code::ModelNotDownloaded,
        Code::ModelUnreadable,
        Code::ModelDownloadFailed,
        Code::ModelIntegrity,
        Code::SyncUnavailable,
        Code::SyncLocked,
        Code::SyncPort,
        Code::SyncFolderMarkerMissing,
        Code::SyncInviteInvalid,
        Code::SyncForeignWrite,
        Code::SyncIdentityCopied,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Code::Invalid => "INVALID",
            Code::NotFound => "NOT_FOUND",
            Code::PermissionDenied => "PERMISSION_DENIED",
            Code::IoError => "IO_ERROR",
            Code::DiskFull => "DISK_FULL",
            Code::Cancelled => "CANCELLED",
            Code::JobBusy => "JOB_BUSY",
            Code::PathOutsideClass => "PATH_OUTSIDE_CLASS",
            Code::SymlinkRefused => "SYMLINK_REFUSED",
            Code::Conflict => "CONFLICT",
            Code::NewerFormat => "NEWER_FORMAT",
            Code::UnsupportedFile => "UNSUPPORTED_FILE",
            Code::NotImplemented => "NOT_IMPLEMENTED",
            Code::AiNoKey => "AI_NO_KEY",
            Code::AiAuth => "AI_AUTH",
            Code::AiNoCredit => "AI_NO_CREDIT",
            Code::AiModelGated => "AI_MODEL_GATED",
            Code::AiFlagged => "AI_FLAGGED",
            Code::AiPrivacyBlocks => "AI_PRIVACY_BLOCKS",
            Code::AiUnsupported => "AI_UNSUPPORTED",
            Code::AiModelUnknown => "AI_MODEL_UNKNOWN",
            Code::AiTooLong => "AI_TOO_LONG",
            Code::AiBadRequest => "AI_BAD_REQUEST",
            Code::AiBusy => "AI_BUSY",
            Code::AiFreeLimit => "AI_FREE_LIMIT",
            Code::AiUpstream => "AI_UPSTREAM",
            Code::AiUnavailable => "AI_UNAVAILABLE",
            Code::AiTimeout => "AI_TIMEOUT",
            Code::AiOffline => "AI_OFFLINE",
            Code::AiLength => "AI_LENGTH",
            Code::AiHostNotAllowed => "AI_HOST_NOT_ALLOWED",
            Code::AiBadAddress => "AI_BAD_ADDRESS",
            Code::SpeechNoDevice => "SPEECH_NO_DEVICE",
            Code::SpeechPermission => "SPEECH_PERMISSION",
            Code::SpeechNoSystemAudio => "SPEECH_NO_SYSTEM_AUDIO",
            Code::SpeechUnsupportedAudio => "SPEECH_UNSUPPORTED_AUDIO",
            Code::SpeechNoSpeech => "SPEECH_NO_SPEECH",
            Code::SpeechUnsupportedCpu => "SPEECH_UNSUPPORTED_CPU",
            Code::ModelNotDownloaded => "MODEL_NOT_DOWNLOADED",
            Code::ModelUnreadable => "MODEL_UNREADABLE",
            Code::ModelDownloadFailed => "MODEL_DOWNLOAD_FAILED",
            Code::ModelIntegrity => "MODEL_INTEGRITY",
            Code::SyncUnavailable => "SYNC_UNAVAILABLE",
            Code::SyncLocked => "SYNC_LOCKED",
            Code::SyncPort => "SYNC_PORT",
            Code::SyncFolderMarkerMissing => "SYNC_FOLDER_MARKER_MISSING",
            Code::SyncInviteInvalid => "SYNC_INVITE_INVALID",
            Code::SyncForeignWrite => "SYNC_FOREIGN_WRITE",
            Code::SyncIdentityCopied => "SYNC_IDENTITY_COPIED",
        }
    }

    /// The code for its wire name (`"NOT_FOUND"` → `NotFound`).
    pub fn parse(s: &str) -> Option<Code> {
        Code::ALL.iter().copied().find(|c| c.as_str() == s)
    }
}

impl std::fmt::Display for Code {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Coded {
        code: Code,
        message: String,
        data: Option<serde_json::Value>,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        AppError::Coded {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// Attaches the `data` payload of architecture §15 (e.g. `DISK_FULL {needBytes}`).
    pub fn with_data(self, data: serde_json::Value) -> Self {
        match self {
            AppError::Coded { code, message, .. } => AppError::Coded {
                code,
                message,
                data: Some(data),
            },
            AppError::Io(e) => AppError::Coded {
                code: io_code(&e),
                message: e.to_string(),
                data: Some(data),
            },
        }
    }

    pub fn code(&self) -> Code {
        match self {
            AppError::Coded { code, .. } => *code,
            AppError::Io(e) => io_code(e),
        }
    }

    pub fn data(&self) -> Option<&serde_json::Value> {
        match self {
            AppError::Coded { data, .. } => data.as_ref(),
            AppError::Io(_) => None,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        AppError::new(Code::Invalid, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        AppError::new(Code::NotFound, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        AppError::new(Code::Conflict, message)
    }

    /// Scaffold stubs (architecture D-2); the release gate fails while any command can return it.
    pub fn not_implemented(what: &str) -> Self {
        AppError::new(Code::NotImplemented, format!("not implemented yet: {what}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::new(Code::Invalid, format!("bad JSON: {e}"))
    }
}

/// The code of an I/O error: the kinds the UI tells apart, and "disk full" by its raw OS code
/// where the standard library has no kind for it.
fn io_code(e: &std::io::Error) -> Code {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::NotFound => return Code::NotFound,
        ErrorKind::PermissionDenied => return Code::PermissionDenied,
        ErrorKind::AlreadyExists => return Code::Conflict,
        ErrorKind::StorageFull | ErrorKind::QuotaExceeded => return Code::DiskFull,
        _ => {}
    }
    match e.raw_os_error() {
        Some(raw) if is_disk_full_os_error(raw) => Code::DiskFull,
        _ => Code::IoError,
    }
}

#[cfg(unix)]
fn is_disk_full_os_error(raw: i32) -> bool {
    raw == libc::ENOSPC || raw == libc::EDQUOT
}

#[cfg(windows)]
fn is_disk_full_os_error(raw: i32) -> bool {
    // ERROR_DISK_FULL (112), ERROR_HANDLE_DISK_FULL (39).
    raw == 112 || raw == 39
}

#[cfg(not(any(unix, windows)))]
fn is_disk_full_os_error(_raw: i32) -> bool {
    false
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let data = self.data();
        let mut st = s.serialize_struct("AppError", if data.is_some() { 3 } else { 2 })?;
        st.serialize_field("code", self.code().as_str())?;
        st.serialize_field("message", &self.to_string())?;
        if let Some(d) = data {
            st.serialize_field("data", d)?;
        }
        st.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serialises_code_message_and_data() {
        let e = AppError::new(Code::DiskFull, "no space").with_data(json!({"needBytes": 10}));
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(
            v,
            json!({"code": "DISK_FULL", "message": "no space", "data": {"needBytes": 10}})
        );
        let v = serde_json::to_value(AppError::invalid("x")).unwrap();
        assert_eq!(v, json!({"code": "INVALID", "message": "x"}));
    }

    #[test]
    fn io_errors_map_to_codes() {
        use std::io::{Error, ErrorKind};
        assert_eq!(
            AppError::from(Error::from(ErrorKind::NotFound)).code(),
            Code::NotFound
        );
        assert_eq!(
            AppError::from(Error::from(ErrorKind::PermissionDenied)).code(),
            Code::PermissionDenied
        );
        assert_eq!(
            AppError::from(Error::from(ErrorKind::AlreadyExists)).code(),
            Code::Conflict
        );
        assert_eq!(
            AppError::from(Error::from(ErrorKind::StorageFull)).code(),
            Code::DiskFull
        );
        #[cfg(unix)]
        assert_eq!(
            AppError::from(Error::from_raw_os_error(libc::ENOSPC)).code(),
            Code::DiskFull
        );
        assert_eq!(AppError::from(Error::other("boom")).code(), Code::IoError);
        let with = AppError::from(Error::from(ErrorKind::NotFound)).with_data(json!({"path": "a"}));
        assert_eq!(with.code(), Code::NotFound);
        assert_eq!(with.data(), Some(&json!({"path": "a"})));
    }

    #[test]
    fn as_str_matches_serde_and_parse() {
        for c in Code::ALL {
            assert_eq!(serde_json::to_value(c).unwrap(), json!(c.as_str()));
            assert_eq!(Code::parse(c.as_str()), Some(c));
            let back: Code = serde_json::from_value(json!(c.as_str())).unwrap();
            assert_eq!(back, c);
        }
        assert_eq!(Code::parse("NOPE"), None);
    }
}
