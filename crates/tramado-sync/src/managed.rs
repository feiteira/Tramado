// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Managed settings, re-applied at every start (sync spec §2.7): options, this device's name
//! (§9.4), the §6.2 folder settings and the managed `.stignore` of folder spec §11 (managed
//! block, per-device lines from the registry, user lines kept).

use serde_json::{json, Value};
use tramado_base::registry::ClassEntry;

use crate::types::SyncSettings;

pub const MANAGED_HEADER: &str = "// Tramado managed ignores (v1)";
pub const MANAGED_BLOCK: [&str; 11] = [
    "(?d).DS_Store",
    "(?d)Thumbs.db",
    "(?d)desktop.ini",
    "(?d)._*",
    "/.tramado/tmp",
    "*.tmp",
    "*.part",
    "*.crdownload",
    "(?d)~$*",
    "(?d).~lock.*#",
    "(?d)*.swp",
];
pub const PER_DEVICE_HEADER: &str = "// Tramado per-device (v1)";
pub const SKIP_AUDIO_COMMENT: &str = "// skip audio files";
pub const SKIP_AUDIO_LINE: &str = "(?d)/**/audio.webm";
pub const LOCAL_COMMENT: &str = "// removed from this computer only";
pub const INCLUDE_COMMENT: &str = "// recordings fetched although audio is skipped";
pub const USER_MARKER: &str = "// User patterns (kept by Tramado)";

/// The own device name while no class is joining (§9.4).
pub const DEFAULT_DEVICE_NAME: &str = "Tramado";

/// Escapes glob characters of a class path for an anchored ignore line (Syncthing's escape
/// character is `\` except on Windows, where `\` is a separator and none is needed for these).
fn escape_glob(path: &str) -> String {
    if cfg!(windows) {
        return path.to_string();
    }
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        if matches!(c, '*' | '?' | '[' | ']' | '{' | '}' | '\\' | '!') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The full `.stignore` for a class on this device: managed block, per-device lines, then the
/// user's own lines (everything after the marker in `existing`).
pub fn ignore_lines(
    skip_audio: bool,
    local_ignores: &[String],
    existing: &[String],
) -> Vec<String> {
    ignore_lines_with(skip_audio, local_ignores, &[], existing)
}

/// [`ignore_lines`] plus the recordings this device fetches although it skips audio
/// ("Get the recording", UX §3.5.2): each `audio.webm` path is emitted as `!/` + path right
/// before the skip-audio line, because Syncthing applies the first pattern that matches.
pub fn ignore_lines_with(
    skip_audio: bool,
    local_ignores: &[String],
    local_includes: &[String],
    existing: &[String],
) -> Vec<String> {
    let mut out: Vec<String> = vec![MANAGED_HEADER.to_string()];
    out.extend(MANAGED_BLOCK.iter().map(|s| s.to_string()));
    let usable = |p: &&String| !p.is_empty() && !p.contains('\n') && !p.starts_with('/');
    let locals: Vec<&String> = local_ignores.iter().filter(usable).collect();
    let includes: Vec<&String> = local_includes
        .iter()
        .filter(usable)
        .filter(|p| p.ends_with("/audio.webm"))
        .collect();
    if skip_audio || !locals.is_empty() {
        out.push(PER_DEVICE_HEADER.to_string());
        if skip_audio {
            if !includes.is_empty() {
                out.push(INCLUDE_COMMENT.to_string());
                for p in includes {
                    out.push(format!("!/{}", escape_glob(p)));
                }
            }
            out.push(SKIP_AUDIO_COMMENT.to_string());
            out.push(SKIP_AUDIO_LINE.to_string());
        }
        if !locals.is_empty() {
            out.push(LOCAL_COMMENT.to_string());
            for p in locals {
                out.push(format!("(?d)/{}", escape_glob(p)));
            }
        }
    }
    out.push(USER_MARKER.to_string());
    if let Some(i) = existing.iter().position(|l| l.trim() == USER_MARKER) {
        out.extend(existing[i + 1..].iter().cloned());
    }
    out
}

pub fn ignore_lines_for(entry: &ClassEntry, existing: &[String]) -> Vec<String> {
    ignore_lines_with(
        entry.skip_audio,
        &entry.local_ignores,
        &entry.local_includes,
        existing,
    )
}

/// `PATCH /rest/config/options` (§2.7, §21). `dev_isolated` (TRAMADO_DATA_DIR): loopback only,
/// no discovery, relays or NAT (§2.4).
pub fn options_body(port: u16, settings: &SyncSettings, dev_isolated: bool) -> Value {
    let local_only = settings.local_only || dev_isolated;
    let listen = if dev_isolated {
        json!([format!("tcp://127.0.0.1:{port}")])
    } else {
        json!([
            format!("tcp://0.0.0.0:{port}"),
            format!("quic://0.0.0.0:{port}"),
            "dynamic+https://relays.syncthing.net/endpoint"
        ])
    };
    json!({
        "listenAddresses": listen,
        "globalAnnounceEnabled": !local_only,
        "localAnnounceEnabled": !dev_isolated,
        "relaysEnabled": !local_only,
        "natEnabled": !local_only,
        "urAccepted": -1,
        "urSeen": 3,
        "startBrowser": false,
        "autoUpgradeIntervalH": 0,
        "crashReportingEnabled": false,
        "overwriteRemoteDeviceNamesOnConnect": true,
        "maxSendKbps": settings.max_send_kbps,
        "maxRecvKbps": settings.max_recv_kbps
    })
}

/// The §6.2 settings re-sent with PATCH at every start (no id, path, devices or paused).
pub fn folder_settings(label: &str) -> Value {
    json!({
        "label": label,
        "type": "sendreceive",
        "fsWatcherEnabled": true,
        "fsWatcherDelayS": 1,
        "pullerDelayS": 0,
        "rescanIntervalS": 3600,
        "maxConflicts": 10,
        "versioning": { "type": "trashcan", "params": { "cleanoutDays": "30" }, "cleanupIntervalS": 3600 }
    })
}

/// The §6.2 body for `POST /rest/config/folders`: created paused.
pub fn folder_create_body(id: &str, label: &str, path: &str, devices: &[String]) -> Value {
    let mut b = folder_settings(label);
    b["id"] = json!(id);
    b["path"] = json!(path);
    b["paused"] = json!(true);
    b["devices"] = crate::client::devices_body(devices);
    b
}

/// The name this device announces: "Tramado", or "<person> (<computer>)" (≤ 64 chars) while a
/// class is joining (§9.4).
pub fn device_name(joining: bool, settings: Option<&SyncSettings>) -> String {
    match settings {
        Some(s) if joining && !s.device_name.trim().is_empty() => {
            s.device_name.trim().chars().take(64).collect()
        }
        _ => DEFAULT_DEVICE_NAME.to_string(),
    }
}

/// Sync settings before the app pushed any.
pub fn default_settings() -> SyncSettings {
    SyncSettings {
        local_only: false,
        paused: false,
        max_send_kbps: 0,
        max_recv_kbps: 0,
        device_name: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_block_matches_folder_spec_11_1() {
        let lines = ignore_lines(false, &[], &[]);
        assert_eq!(
            lines[..12].join("\n"),
            "// Tramado managed ignores (v1)\n(?d).DS_Store\n(?d)Thumbs.db\n(?d)desktop.ini\n(?d)._*\n/.tramado/tmp\n*.tmp\n*.part\n*.crdownload\n(?d)~$*\n(?d).~lock.*#\n(?d)*.swp"
        );
        assert_eq!(lines.last().unwrap(), USER_MARKER);
    }

    #[test]
    fn per_device_lines_and_user_lines_are_kept() {
        let existing = vec![
            "// Tramado managed ignores (v1)".to_string(),
            "old managed".to_string(),
            USER_MARKER.to_string(),
            "Rascunhos".to_string(),
            "// mine".to_string(),
        ];
        let lines = ignore_lines(
            true,
            &[
                "Documentos/Código Civil anotado.pdf".to_string(),
                "x/[1].md".to_string(),
            ],
            &existing,
        );
        let text = lines.join("\n");
        assert!(text.contains(
            "// Tramado per-device (v1)\n// skip audio files\n(?d)/**/audio.webm\n// removed from this computer only\n(?d)/Documentos/Código Civil anotado.pdf"
        ));
        if !cfg!(windows) {
            assert!(text.contains("(?d)/x/\\[1\\].md"));
        }
        assert!(text.ends_with("// User patterns (kept by Tramado)\nRascunhos\n// mine"));
        assert!(!text.contains("old managed"));
    }

    #[test]
    fn fetched_recordings_come_before_the_skip_audio_line() {
        let includes = vec![
            "Aulas/2026-10-20 Aula 6/audio.webm".to_string(),
            "Aulas/x/notes.md".to_string(),
        ];
        let text = ignore_lines_with(true, &[], &includes, &[]).join("\n");
        assert!(text.contains(
            "// Tramado per-device (v1)\n// recordings fetched although audio is skipped\n!/Aulas/2026-10-20 Aula 6/audio.webm\n// skip audio files\n(?d)/**/audio.webm"
        ));
        // Only recordings are fetched this way, and only while audio is skipped.
        assert!(!text.contains("notes.md"));
        let off = ignore_lines_with(false, &[], &includes, &[]).join("\n");
        assert!(!off.contains("!/"));
        assert!(!off.contains(PER_DEVICE_HEADER));
    }

    #[test]
    fn options_follow_settings_and_isolation() {
        let mut s = default_settings();
        let o = options_body(22117, &s, false);
        assert_eq!(o["listenAddresses"][0], "tcp://0.0.0.0:22117");
        assert_eq!(o["listenAddresses"].as_array().unwrap().len(), 3);
        assert_eq!(o["globalAnnounceEnabled"], true);
        s.local_only = true;
        s.max_send_kbps = 500;
        let o = options_body(22117, &s, false);
        assert_eq!(
            (
                o["relaysEnabled"].clone(),
                o["natEnabled"].clone(),
                o["localAnnounceEnabled"].clone()
            ),
            (json!(false), json!(false), json!(true))
        );
        assert_eq!(o["maxSendKbps"], 500);
        let o = options_body(22100, &default_settings(), true);
        assert_eq!(o["listenAddresses"], json!(["tcp://127.0.0.1:22100"]));
        assert_eq!(o["localAnnounceEnabled"], false);
    }

    #[test]
    fn folder_body_and_device_name() {
        let b = folder_create_body(
            "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa",
            "TGDC",
            "/x",
            &["ME".into()],
        );
        assert_eq!(b["paused"], true);
        assert_eq!(b["pullerDelayS"], 0);
        assert_eq!(b["versioning"]["params"]["cleanoutDays"], "30");
        assert_eq!(b["devices"], json!([{"deviceID": "ME"}]));
        let mut s = default_settings();
        s.device_name = "Ana Ribeiro (portátil)".into();
        assert_eq!(device_name(false, Some(&s)), "Tramado");
        assert_eq!(device_name(true, Some(&s)), "Ana Ribeiro (portátil)");
        assert_eq!(device_name(true, None), "Tramado");
    }
}
