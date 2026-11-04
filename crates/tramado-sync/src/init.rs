// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Identity and pre-spawn checks (sync spec §2.2–§2.5).
//!
//! The identity is made once per installation and **probes no port** (local classes need the
//! device ID for derived IDs and signatures even when nothing may listen): API key, bcrypt'd
//! GUI password, the exact `config.xml` template, `syncthing generate`, `syncthing device-id`,
//! `tramado-instance.json`. Before every spawn: the copied-identity check, the sync port probe
//! (22100–22199, TCP and UDP), a fresh GUI port, and every class folder paused in `config.xml`.

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::{files, ids, time};

pub const CONFIG_FILE: &str = "config.xml";
pub const INSTANCE_FILE: &str = "tramado-instance.json";
pub const INSTANCE_FORMAT: &str = "tramado.syncthing-instance";
pub const PORT_RANGE: std::ops::RangeInclusive<u16> = 22100..=22199;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceFile {
    pub format: String,
    pub version: u32,
    pub device_id: String,
    pub sync_port: Option<u16>,
    pub install_id: String,
    pub machine: Option<String>,
    pub created_at: String,
}

pub fn config_path(home: &Path) -> PathBuf {
    home.join(CONFIG_FILE)
}

pub fn read_instance(home: &Path) -> Option<InstanceFile> {
    let b = std::fs::read(home.join(INSTANCE_FILE)).ok()?;
    serde_json::from_slice(&b).ok()
}

pub fn write_instance(home: &Path, inst: &InstanceFile) -> AppResult<()> {
    files::write_atomic_mode(
        &home.join(INSTANCE_FILE),
        &serde_json::to_vec_pretty(inst)?,
        0o600,
    )
}

/// The `config.xml` of §2.3 (with `{P}` and `{G}` = 0, replaced before the first spawn).
pub fn config_template(api_key: &str, bcrypt_hash: &str) -> String {
    format!(
        r#"<configuration version="52">
    <gui enabled="true" tls="false">
        <address>127.0.0.1:0</address>
        <apikey>{api_key}</apikey>
        <user>tramado</user>
        <password>{bcrypt_hash}</password>
    </gui>
    <options>
        <listenAddress>tcp://0.0.0.0:0</listenAddress>
        <listenAddress>quic://0.0.0.0:0</listenAddress>
        <listenAddress>dynamic+https://relays.syncthing.net/endpoint</listenAddress>
        <globalAnnounceEnabled>true</globalAnnounceEnabled>
        <localAnnounceEnabled>true</localAnnounceEnabled>
        <relaysEnabled>true</relaysEnabled>
        <natEnabled>true</natEnabled>
        <urAccepted>-1</urAccepted>
        <urSeen>3</urSeen>
        <startBrowser>false</startBrowser>
        <autoUpgradeIntervalH>0</autoUpgradeIntervalH>
        <crashReportingEnabled>false</crashReportingEnabled>
        <overwriteRemoteDeviceNamesOnConnect>true</overwriteRemoteDeviceNamesOnConnect>
    </options>
</configuration>
"#
    )
}

/// `$2a$`, cost 10 (§2.3 step 2): Syncthing does not hash a plain password found in config.xml.
pub fn gui_password_hash() -> AppResult<String> {
    let mut raw = [0u8; 32];
    ids::fill_random(&mut raw);
    let pw = base64::engine::general_purpose::STANDARD.encode(raw);
    let h = bcrypt::hash_with_result(pw, 10)
        .map_err(|e| AppError::new(Code::IoError, format!("bcrypt failed: {e}")))?;
    Ok(h.format_for_version(bcrypt::Version::TwoA))
}

/// The child's `Command` with the platform flags every Tramado-spawned Syncthing gets.
pub fn command(bin: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Runs a short Syncthing sub-command (`generate`, `device-id`) with a deadline; stdout.
fn run_tool(bin: &Path, args: &[String], deadline: Duration) -> AppResult<String> {
    let out_dir = tempfile_dir()?;
    let out_path = out_dir.join(format!("st-{}.out", ids::random_token_hex(6)));
    let out = std::fs::File::create(&out_path)?;
    let mut child = command(bin)
        .args(args)
        .env("STNOUPGRADE", "1")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::new(Code::SyncUnavailable, format!("cannot run Syncthing: {e}")))?;
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break s;
        }
        if start.elapsed() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&out_path);
            return Err(AppError::new(
                Code::SyncUnavailable,
                "Syncthing did not finish in time",
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let text = std::fs::read_to_string(&out_path).unwrap_or_default();
    let _ = std::fs::remove_file(&out_path);
    if !status.success() {
        return Err(AppError::new(
            Code::SyncUnavailable,
            format!(
                "syncthing {} failed ({status})",
                args.first().map(String::as_str).unwrap_or("")
            ),
        ));
    }
    Ok(text)
}

fn tempfile_dir() -> AppResult<PathBuf> {
    let d = std::env::temp_dir();
    if d.is_dir() {
        Ok(d)
    } else {
        Err(AppError::new(Code::IoError, "no temporary directory"))
    }
}

/// `syncthing device-id --home=<home>`.
pub fn device_id(bin: &Path, home: &Path) -> AppResult<String> {
    let out = run_tool(
        bin,
        &["device-id".into(), format!("--home={}", home.display())],
        Duration::from_secs(20),
    )?;
    let id = out
        .lines()
        .map(str::trim)
        .find(|l| ids::is_device_id(l))
        .unwrap_or_default();
    if id.is_empty() {
        return Err(AppError::new(
            Code::SyncUnavailable,
            "Syncthing reported no device ID",
        ));
    }
    Ok(id.to_string())
}

/// This computer's machine ID (§2.5 step 0), lower-case; `None` when none can be read.
pub fn machine_id() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        for p in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(s) = std::fs::read_to_string(p) {
                let s = s.trim().to_ascii_lowercase();
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let line = text.lines().find(|l| l.contains("IOPlatformUUID"))?;
        let v = line
            .rsplit('=')
            .next()?
            .trim()
            .trim_matches('"')
            .to_ascii_lowercase();
        (!v.is_empty()).then_some(v)
    }
    #[cfg(windows)]
    {
        let out = command(Path::new("reg"))
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let line = text.lines().find(|l| l.contains("MachineGuid"))?;
        let v = line.split_whitespace().last()?.to_ascii_lowercase();
        (!v.is_empty()).then_some(v)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        None
    }
}

/// §2.3: creates the identity (config.xml, keys, instance file). Nothing listens.
pub fn create_identity(bin: &Path, home: &Path) -> AppResult<InstanceFile> {
    std::fs::create_dir_all(home)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(home, std::fs::Permissions::from_mode(0o700))?;
    }
    let key = ids::random_alnum(32);
    let hash = gui_password_hash()?;
    files::write_atomic_mode(
        &config_path(home),
        config_template(&key, &hash).as_bytes(),
        0o600,
    )?;
    run_tool(
        bin,
        &["generate".into(), format!("--home={}", home.display())],
        Duration::from_secs(60),
    )?;
    // `generate` leaves an empty-ish `.syncthing.tmp.<n>`: harmless, but tidy it.
    if let Ok(rd) = std::fs::read_dir(home) {
        for e in rd.flatten() {
            if e.file_name()
                .to_string_lossy()
                .starts_with(".syncthing.tmp.")
            {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let device_id = device_id(bin, home)?;
    let inst = InstanceFile {
        format: INSTANCE_FORMAT.to_string(),
        version: 1,
        device_id,
        sync_port: None,
        install_id: ids::random_token_hex(16),
        machine: machine_id(),
        created_at: time::instant(time::now_ms()),
    };
    write_instance(home, &inst)?;
    Ok(inst)
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let a = s.find(open)? + open.len();
    let b = s[a..].find(close)? + a;
    Some(&s[a..b])
}

/// `<gui><apikey>` of config.xml (the key lives there and nowhere else, §2.2).
pub fn api_key(home: &Path) -> AppResult<String> {
    let xml = std::fs::read_to_string(config_path(home))?;
    let gui = between(&xml, "<gui", "</gui>").unwrap_or_default();
    let key = between(gui, "<apikey>", "</apikey>")
        .unwrap_or_default()
        .trim();
    if key.is_empty() {
        return Err(AppError::new(
            Code::SyncUnavailable,
            "config.xml has no API key",
        ));
    }
    Ok(key.to_string())
}

fn bind_free(port: u16) -> bool {
    let addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port);
    let tcp = TcpListener::bind(addr);
    let udp = UdpSocket::bind(addr);
    tcp.is_ok() && udp.is_ok()
}

/// §2.4 step 2: the first port of 22100–22199 free for TCP and UDP (never 22000).
pub fn probe_sync_port() -> AppResult<u16> {
    PORT_RANGE
        .clone()
        .find(|p| bind_free(*p))
        .ok_or_else(|| AppError::new(Code::SyncPort, "no free port in 22100–22199"))
}

/// §2.4 step 3: a free loopback port for the GUI/REST address.
pub fn free_gui_port() -> AppResult<u16> {
    let l = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
    Ok(l.local_addr()?.port())
}

/// Replaces the text content of every `<tag>…</tag>` inside `[from, to)` of `xml`.
fn set_elements(xml: &str, tag: &str, value: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(xml.len());
    let mut rest = xml;
    while let Some(a) = rest.find(&open) {
        let Some(b) = rest[a..].find(&close) else {
            break;
        };
        out.push_str(&rest[..a + open.len()]);
        out.push_str(value);
        rest = &rest[a + b..];
    }
    out.push_str(rest);
    out
}

/// Sets `<tag>value</tag>` inside the `<options>` block, inserting it when missing.
fn set_option(xml: &str, tag: &str, value: &str) -> String {
    let (Some(a), Some(b)) = (xml.find("<options>"), xml.find("</options>")) else {
        return xml.to_string();
    };
    let (head, block, tail) = (&xml[..a], &xml[a..b], &xml[b..]);
    let block = if block.contains(&format!("<{tag}>")) {
        set_elements(block, tag, value)
    } else {
        format!("{block}    <{tag}>{value}</{tag}>\n    ")
    };
    format!("{head}{block}{tail}")
}

/// The pre-spawn edits of §2.4 on config.xml's text: listen addresses on `sync_port`, the GUI
/// on `gui_port`, every `tramado-*` folder paused, and the loopback variant when isolated.
pub fn edit_config_xml(xml: &str, sync_port: u16, gui_port: u16, dev_isolated: bool) -> String {
    let mut x = xml.to_string();
    // GUI address
    if let (Some(a), Some(b)) = (x.find("<gui"), x.find("</gui>")) {
        let block = set_elements(&x[a..b], "address", &format!("127.0.0.1:{gui_port}"));
        x = format!("{}{}{}", &x[..a], block, &x[b..]);
    }
    // listen addresses: drop every one, insert ours where the first was
    if let (Some(a), Some(b)) = (x.find("<options>"), x.find("</options>")) {
        let block = &x[a..b];
        let mut kept: Vec<&str> = Vec::new();
        let mut first = None;
        for (i, line) in block.split_inclusive('\n').enumerate() {
            if line.trim_start().starts_with("<listenAddress>") {
                first.get_or_insert(i);
                continue;
            }
            kept.push(line);
        }
        let ours: Vec<String> = if dev_isolated {
            vec![format!("tcp://127.0.0.1:{sync_port}")]
        } else {
            vec![
                format!("tcp://0.0.0.0:{sync_port}"),
                format!("quic://0.0.0.0:{sync_port}"),
                "dynamic+https://relays.syncthing.net/endpoint".to_string(),
            ]
        };
        let lines: String = ours
            .iter()
            .map(|l| format!("        <listenAddress>{l}</listenAddress>\n"))
            .collect();
        let at = first.unwrap_or(1).min(kept.len());
        let mut nb = String::new();
        for (i, line) in kept.iter().enumerate() {
            if i == at {
                nb.push_str(&lines);
            }
            nb.push_str(line);
        }
        if at >= kept.len() {
            nb.push_str(&lines);
        }
        x = format!("{}{}{}", &x[..a], nb, &x[b..]);
    }
    if dev_isolated {
        for tag in [
            "globalAnnounceEnabled",
            "localAnnounceEnabled",
            "relaysEnabled",
            "natEnabled",
        ] {
            x = set_option(&x, tag, "false");
        }
    }
    pause_class_folders(&x)
}

/// §2.4 step 4: every `<folder id="tramado-…">` gets `<paused>true</paused>`.
pub fn pause_class_folders(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() + 64);
    let mut rest = xml;
    while let Some(a) = rest.find("<folder id=\"tramado-") {
        let Some(len) = rest[a..].find("</folder>") else {
            break;
        };
        let end = a + len;
        out.push_str(&rest[..a]);
        let elem = &rest[a..end];
        if elem.contains("<paused>") {
            out.push_str(&set_elements(elem, "paused", "true"));
        } else {
            out.push_str(elem);
            out.push_str("    <paused>true</paused>\n    ");
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// What a spawn needs (§2.4).
pub struct Prepared {
    pub sync_port: u16,
    pub gui_port: u16,
    pub api_key: String,
}

/// §2.4 steps 1–4 (Syncthing is not running and config.xml is ours).
pub fn prespawn(home: &Path, dev_isolated: bool, reprobe_port: bool) -> AppResult<Prepared> {
    let mut inst = read_instance(home)
        .ok_or_else(|| AppError::new(Code::SyncUnavailable, "the sharing identity is missing"))?;
    // 1. copied identity
    if let Some(m) = machine_id() {
        match &inst.machine {
            Some(x) if *x != m => {
                return Err(AppError::new(
                    Code::SyncIdentityCopied,
                    "the Syncthing home was copied from another computer",
                ))
            }
            None => {
                inst.machine = Some(m);
                write_instance(home, &inst)?;
            }
            _ => {}
        }
    }
    // 2. sync port
    let sync_port = match inst.sync_port {
        Some(p) if !reprobe_port && PORT_RANGE.contains(&p) => p,
        _ => {
            let p = probe_sync_port()?;
            inst.sync_port = Some(p);
            write_instance(home, &inst)?;
            p
        }
    };
    // 3. GUI port
    let gui_port = free_gui_port()?;
    // 4. rewrite config.xml (and pause every class folder)
    let path = config_path(home);
    let xml = std::fs::read_to_string(&path)?;
    let edited = edit_config_xml(&xml, sync_port, gui_port, dev_isolated);
    if edited != xml {
        files::write_atomic_mode(&path, edited.as_bytes(), 0o600)?;
    }
    Ok(Prepared {
        sync_port,
        gui_port,
        api_key: api_key(home)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<configuration version="52">
    <folder id="tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa" label="T" path="/x" type="sendreceive">
        <filesystemType>basic</filesystemType>
        <paused>false</paused>
    </folder>
    <folder id="photos" label="P" path="/p" type="sendreceive">
        <paused>false</paused>
    </folder>
    <folder id="tramado-bbbbbbbbbbbbbbbbbbbbbbbbbb" label="U" path="/y" type="sendreceive">
        <filesystemType>basic</filesystemType>
    </folder>
    <gui enabled="true" tls="false">
        <address>127.0.0.1:8384</address>
        <apikey>KEY123</apikey>
    </gui>
    <options>
        <listenAddress>default</listenAddress>
        <globalAnnounceEnabled>true</globalAnnounceEnabled>
        <relaysEnabled>true</relaysEnabled>
    </options>
    <defaults>
        <folder id="" label="" path="">
            <paused>false</paused>
        </folder>
    </defaults>
</configuration>
"#;

    #[test]
    fn template_is_exact() {
        let t = config_template("K", "$2a$10$h");
        assert!(t.starts_with("<configuration version=\"52\">\n    <gui enabled=\"true\" tls=\"false\">\n        <address>127.0.0.1:0</address>\n        <apikey>K</apikey>\n        <user>tramado</user>\n        <password>$2a$10$h</password>"));
        assert!(t.contains("<listenAddress>tcp://0.0.0.0:0</listenAddress>"));
        assert!(t.contains("<urAccepted>-1</urAccepted>"));
    }

    #[test]
    fn bcrypt_hash_is_2a_cost_10() {
        let h = gui_password_hash().unwrap();
        assert!(h.starts_with("$2a$10$"), "{h}");
    }

    #[test]
    fn prespawn_edits_ports_and_pauses_only_class_folders() {
        let x = edit_config_xml(SAMPLE, 22117, 40001, false);
        assert!(x.contains("<address>127.0.0.1:40001</address>"));
        assert!(!x.contains("<listenAddress>default</listenAddress>"));
        assert!(x.contains("<listenAddress>tcp://0.0.0.0:22117</listenAddress>\n        <listenAddress>quic://0.0.0.0:22117</listenAddress>"));
        let a = x.find("tramado-aaaa").unwrap();
        assert!(x[a..].find("<paused>true</paused>").unwrap() < x[a..].find("</folder>").unwrap());
        let p = x.find("id=\"photos\"").unwrap();
        assert!(
            x[p..p + 200].contains("<paused>false</paused>"),
            "a user folder is untouched"
        );
        let b = x.find("tramado-bbbb").unwrap();
        assert!(x[b..].find("<paused>true</paused>").unwrap() < x[b..].find("</folder>").unwrap());
        assert!(
            x.contains("<folder id=\"\" label=\"\" path=\"\">\n            <paused>false</paused>")
        );
        assert_eq!(edit_config_xml(&x, 22117, 40001, false), x, "idempotent");
        let iso = edit_config_xml(SAMPLE, 22100, 40002, true);
        assert!(iso.contains("<listenAddress>tcp://127.0.0.1:22100</listenAddress>"));
        assert!(!iso.contains("quic://"));
        assert!(iso.contains("<globalAnnounceEnabled>false</globalAnnounceEnabled>"));
        assert!(iso.contains("<natEnabled>false</natEnabled>"));
        assert!(iso.contains("<localAnnounceEnabled>false</localAnnounceEnabled>"));
    }

    #[test]
    fn api_key_and_ports() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CONFIG_FILE), SAMPLE).unwrap();
        assert_eq!(api_key(dir.path()).unwrap(), "KEY123");
        let p = probe_sync_port().unwrap();
        assert!(PORT_RANGE.contains(&p));
        assert!(free_gui_port().unwrap() > 0);
    }
}
