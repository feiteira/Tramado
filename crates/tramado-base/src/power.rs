// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Power source (architecture §5.1 `power`, §6.5 `system_power`): mains or battery, and the
//! battery level when known. Volunteering for transcription waits for mains power by default
//! (`speech.volunteer = plugged`, sync spec §14.3), and the recorder warns on a low battery.
//!
//! Linux reads `/sys/class/power_supply/*/{type,online,status,capacity}`, Windows
//! `GetSystemPowerStatus`, macOS parses `pmset -g batt`; anything else is `unknown`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PowerSource {
    Ac,
    Battery,
    Unknown,
}

/// TS `Power`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Power {
    pub source: PowerSource,
    pub percent: Option<u8>,
}

impl Power {
    pub const UNKNOWN: Power = Power {
        source: PowerSource::Unknown,
        percent: None,
    };
}

pub fn system_power() -> Power {
    #[cfg(target_os = "linux")]
    {
        from_sysfs(std::path::Path::new("/sys/class/power_supply"))
    }
    #[cfg(windows)]
    {
        windows_power()
    }
    #[cfg(target_os = "macos")]
    {
        match std::process::Command::new("/usr/bin/pmset")
            .args(["-g", "batt"])
            .output()
        {
            Ok(out) if out.status.success() => parse_pmset(&String::from_utf8_lossy(&out.stdout)),
            _ => Power::UNKNOWN,
        }
    }
    #[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
    {
        Power::UNKNOWN
    }
}

fn read_trim(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p)
        .ok()
        .map(|s| s.trim().to_string())
}

/// Linux: a `Mains`/`USB` supply with `online = 1` means AC; else a `Battery` whose `status` is
/// `Discharging` means battery. Desktops without a battery report AC when a mains supply exists
/// and `unknown` when there is no supply at all (most VMs). `percent` is the first battery's
/// `capacity`.
pub fn from_sysfs(dir: &std::path::Path) -> Power {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Power::UNKNOWN;
    };
    let mut names: Vec<std::path::PathBuf> = entries.flatten().map(|e| e.path()).collect();
    names.sort();
    let mut mains_seen = false;
    let mut mains_online = false;
    let mut battery_seen = false;
    let mut discharging = false;
    let mut percent = None;
    for supply in names {
        let kind = read_trim(&supply.join("type")).unwrap_or_default();
        match kind.as_str() {
            "Mains" | "USB" | "USB_C" | "USB_PD" => {
                mains_seen = true;
                if read_trim(&supply.join("online")).as_deref() == Some("1") {
                    mains_online = true;
                }
            }
            "Battery" => {
                // Peripheral batteries (mice, headsets) say scope=Device: not the computer's.
                if read_trim(&supply.join("scope")).as_deref() == Some("Device") {
                    continue;
                }
                battery_seen = true;
                if read_trim(&supply.join("status")).as_deref() == Some("Discharging") {
                    discharging = true;
                }
                if percent.is_none() {
                    percent = read_trim(&supply.join("capacity"))
                        .and_then(|c| c.parse::<u16>().ok())
                        .map(|c| c.min(100) as u8);
                }
            }
            _ => {}
        }
    }
    let source = if mains_online {
        PowerSource::Ac
    } else if battery_seen && discharging {
        PowerSource::Battery
    } else if battery_seen && mains_seen {
        // A mains supply is known but offline, and the battery is not discharging (full).
        PowerSource::Battery
    } else if battery_seen {
        // Charging or full without a visible mains supply: plugged in.
        PowerSource::Ac
    } else if mains_seen {
        PowerSource::Battery
    } else {
        PowerSource::Unknown
    };
    Power { source, percent }
}

/// macOS `pmset -g batt`: `Now drawing from 'AC Power'` / `'Battery Power'`, then a line with
/// `NN%` for the internal battery.
pub fn parse_pmset(out: &str) -> Power {
    let source = if out.contains("'AC Power'") {
        PowerSource::Ac
    } else if out.contains("'Battery Power'") {
        PowerSource::Battery
    } else {
        PowerSource::Unknown
    };
    let percent = out.lines().find_map(|l| {
        let i = l.find('%')?;
        let digits: String = l[..i]
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        digits.parse::<u16>().ok().map(|p| p.min(100) as u8)
    });
    Power { source, percent }
}

#[cfg(windows)]
fn windows_power() -> Power {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    // SAFETY: GetSystemPowerStatus fills a plain struct we own.
    let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
        return Power::UNKNOWN;
    }
    let source = match s.ACLineStatus {
        1 => PowerSource::Ac,
        0 => PowerSource::Battery,
        _ => PowerSource::Unknown,
    };
    // 255 = unknown; flag 128 = no system battery.
    let percent =
        (s.BatteryLifePercent <= 100 && s.BatteryFlag & 128 == 0).then_some(s.BatteryLifePercent);
    Power { source, percent }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn supply(dir: &Path, name: &str, files: &[(&str, &str)]) {
        let d = dir.join(name);
        fs::create_dir_all(&d).unwrap();
        for (k, v) in files {
            fs::write(d.join(k), format!("{v}\n")).unwrap();
        }
    }

    #[test]
    fn linux_sysfs() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(from_sysfs(&dir.path().join("none")), Power::UNKNOWN);
        assert_eq!(from_sysfs(dir.path()), Power::UNKNOWN);
        supply(dir.path(), "AC", &[("type", "Mains"), ("online", "1")]);
        supply(
            dir.path(),
            "BAT0",
            &[
                ("type", "Battery"),
                ("status", "Charging"),
                ("capacity", "57"),
            ],
        );
        supply(
            dir.path(),
            "hidpp_battery_0",
            &[
                ("type", "Battery"),
                ("scope", "Device"),
                ("status", "Discharging"),
                ("capacity", "5"),
            ],
        );
        assert_eq!(
            from_sysfs(dir.path()),
            Power {
                source: PowerSource::Ac,
                percent: Some(57)
            }
        );
        supply(dir.path(), "AC", &[("online", "0")]);
        supply(
            dir.path(),
            "BAT0",
            &[("status", "Discharging"), ("capacity", "31")],
        );
        assert_eq!(
            from_sysfs(dir.path()),
            Power {
                source: PowerSource::Battery,
                percent: Some(31)
            }
        );
        // A desktop: mains only.
        let desk = tempfile::tempdir().unwrap();
        supply(desk.path(), "ACAD", &[("type", "Mains"), ("online", "1")]);
        assert_eq!(
            from_sysfs(desk.path()),
            Power {
                source: PowerSource::Ac,
                percent: None
            }
        );
        let json = serde_json::to_value(from_sysfs(desk.path())).unwrap();
        assert_eq!(json, serde_json::json!({"source": "ac", "percent": null}));
    }

    #[test]
    fn macos_pmset() {
        let ac = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t100%; charged; 0:00 remaining present: true\n";
        assert_eq!(
            parse_pmset(ac),
            Power {
                source: PowerSource::Ac,
                percent: Some(100)
            }
        );
        let batt = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t42%; discharging; 3:10 remaining present: true\n";
        assert_eq!(
            parse_pmset(batt),
            Power {
                source: PowerSource::Battery,
                percent: Some(42)
            }
        );
        assert_eq!(parse_pmset("garbage"), Power::UNKNOWN);
    }

    #[test]
    fn this_computer_answers() {
        // Whatever the machine is, the call returns without panicking.
        let p = system_power();
        assert!(p.percent.is_none_or(|x| x <= 100));
    }
}
