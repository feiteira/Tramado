// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Detection of a user's own Syncthing (critique G1). Tramado never uses, configures or reads
//! it beyond these two facts; it only tells the person that the two coexist (on their own ports).

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

use crate::types::ExistingSyncthing;

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Where a stock Syncthing keeps its `config.xml` on this OS.
pub fn config_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(h) = home() {
        if cfg!(target_os = "macos") {
            out.push(h.join("Library/Application Support/Syncthing/config.xml"));
        } else if !cfg!(windows) {
            let state = std::env::var_os("XDG_STATE_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| h.join(".local/state"));
            out.push(state.join("syncthing/config.xml"));
            let cfg = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| h.join(".config"));
            out.push(cfg.join("syncthing/config.xml"));
        }
    }
    if cfg!(windows) {
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            out.push(PathBuf::from(l).join("Syncthing/config.xml"));
        }
    }
    out
}

/// The GUI address of a user config (`<gui><address>`), else the default `127.0.0.1:8384`.
fn gui_address(config: Option<&PathBuf>) -> SocketAddr {
    let default: SocketAddr = ([127, 0, 0, 1], 8384).into();
    let Some(text) = config.and_then(|p| std::fs::read_to_string(p).ok()) else {
        return default;
    };
    let Some(a) = text.find("<gui") else {
        return default;
    };
    let block = &text[a..];
    let addr = block
        .find("<address>")
        .and_then(|i| {
            let rest = &block[i + 9..];
            rest.find("</address>")
                .map(|j| rest[..j].trim().to_string())
        })
        .unwrap_or_default();
    addr.trim_start_matches("http://")
        .trim_start_matches("https://")
        .replace("0.0.0.0", "127.0.0.1")
        .parse()
        .unwrap_or(default)
}

/// `{running, configFound}`: a quick TCP probe of the user's GUI address; no request is made.
pub fn detect() -> ExistingSyncthing {
    let found = config_candidates().into_iter().find(|p| p.is_file());
    let addr = gui_address(found.as_ref());
    let running = TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok();
    ExistingSyncthing {
        running,
        config_found: found.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_gui_address_of_a_user_config() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.xml");
        std::fs::write(&p, "<configuration><gui enabled=\"true\"><address>0.0.0.0:9999</address></gui></configuration>").unwrap();
        assert_eq!(gui_address(Some(&p)), "127.0.0.1:9999".parse().unwrap());
        assert_eq!(gui_address(None), "127.0.0.1:8384".parse().unwrap());
        let _ = detect();
    }
}
