// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Contract tests against the pinned Syncthing binary (sync spec §24, plan §3.2). Every test is
//! `#[ignore]` and needs `TRAMADO_SYNCTHING_BIN`; run them with `npm run test:contract`.

mod common;

use std::time::{Duration, Instant};

use common::*;
use serde_json::json;
use tramado_base::ids;
use tramado_sync::admission::Admission;
use tramado_sync::client::{folder_devices, to_class_path};
use tramado_sync::events::MASK_A;
use tramado_sync::{init, sign};

const MINUTE: Duration = Duration::from_secs(60);

#[test]
#[ignore]
fn preseed_and_generate() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("syncthing");
    let start = Instant::now();
    let inst = init::create_identity(&bin(), &home).unwrap();
    assert!(start.elapsed() < Duration::from_secs(10));
    assert!(ids::is_valid_device_id(&inst.device_id));
    assert_eq!(inst.sync_port, None, "no port is probed at identity time");
    assert_eq!(inst.install_id.len(), 32);
    let xml = std::fs::read_to_string(home.join("config.xml")).unwrap();
    // generate kept every pre-seeded value
    assert!(xml.contains("<urAccepted>-1</urAccepted>"));
    assert!(xml.contains("<startBrowser>false</startBrowser>"));
    assert!(xml.contains("<crashReportingEnabled>false</crashReportingEnabled>"));
    assert!(xml.contains("<listenAddress>tcp://0.0.0.0:0</listenAddress>"));
    assert!(!xml.contains(":22000"));
    assert!(xml.contains("<password>$2a$10$"));
    assert!(xml.contains(&format!("<device id=\"{}\"", inst.device_id)));
    assert_eq!(init::api_key(&home).unwrap().len(), 32);
    assert!(home.join("cert.pem").is_file() && home.join("key.pem").is_file());
    assert_eq!(init::read_instance(&home).unwrap(), inst);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&home).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(home.join("config.xml"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
#[ignore]
fn folder_create_paused_ignores_resume() {
    let a = Raw::new();
    let f = new_folder_id(&a.id);
    let path = a.folder_path(&f);
    a.c.add_folder(&tramado_sync::managed::folder_create_body(
        &f,
        "TGDC",
        &path.to_string_lossy(),
        &[a.id.clone()],
    ))
    .unwrap();
    let st = a.c.db_status(&f).unwrap();
    assert_eq!(st["state"], "", "paused folders report an empty state");
    let lines = tramado_sync::managed::ignore_lines(true, &["Docs/x.pdf".into()], &[]);
    a.c.set_ignores(&f, &lines).unwrap();
    assert_eq!(
        a.c.ignores(&f).unwrap(),
        lines,
        "ignores set on a paused folder"
    );
    assert!(
        path.join(".stignore").is_file(),
        "the ignores POST writes .stignore (and the directory)"
    );
    a.c.patch_folder(&f, &json!({"paused": false})).unwrap();
    assert!(wait_until(Duration::from_secs(10), || a
        .c
        .db_status(&f)
        .unwrap()["state"]
        == "idle"));
    assert!(
        path.join(".stfolder").exists(),
        "resuming created the folder marker"
    );
    let cfg = a.c.folder(&f).unwrap().unwrap();
    assert_eq!(cfg["pullerDelayS"], 0);
    assert_eq!(cfg["fsWatcherDelayS"], 1);
    assert_eq!(cfg["versioning"]["type"], "trashcan");
    assert_eq!(cfg["maxConflicts"], 10);
    assert_eq!(
        a.c.get("/rest/config/restart-required").unwrap()["requiresRestart"],
        false
    );
}

#[test]
#[ignore]
fn post_replaces_folder_and_device() {
    let a = Raw::new();
    let other = "5QDNN46-YHG4AH2-3NWSGYW-RYXVGJP-JORVLZ4-3VGOMPY-S5KL2O6-AXZBAQE";
    a.c.add_device(
        &json!({"deviceID": other, "name": "Bruno", "addresses": ["tcp://127.0.0.1:1", "dynamic"]}),
    )
    .unwrap();
    let f = new_folder_id(&a.id);
    let path = a.folder_path(&f);
    let body = tramado_sync::managed::folder_create_body(
        &f,
        "TGDC",
        &path.to_string_lossy(),
        &[a.id.clone(), other.into()],
    );
    a.c.add_folder(&body).unwrap();
    assert_eq!(folder_devices(&a.c.folder(&f).unwrap().unwrap()).len(), 2);
    // POST of an existing folder replaces it, devices included (§3.3)
    let body2 = tramado_sync::managed::folder_create_body(
        &f,
        "TGDC",
        &path.to_string_lossy(),
        &[a.id.clone()],
    );
    a.c.add_folder(&body2).unwrap();
    assert_eq!(
        folder_devices(&a.c.folder(&f).unwrap().unwrap()),
        vec![a.id.clone()]
    );
    // PATCH replaces the devices array whole
    a.c.patch_folder(
        &f,
        &json!({"devices": [{"deviceID": a.id}, {"deviceID": other}]}),
    )
    .unwrap();
    assert_eq!(folder_devices(&a.c.folder(&f).unwrap().unwrap()).len(), 2);
    // POST of an existing device replaces it (name and addresses reset)
    a.c.add_device(&json!({"deviceID": other})).unwrap();
    let d = a.c.device(other).unwrap().unwrap();
    assert_eq!(d["name"], "");
    assert_eq!(d["addresses"], json!(["dynamic"]));
    // DELETE of a device drops it from folders too; DELETE of a folder keeps the files
    a.c.delete_device(other).unwrap();
    assert_eq!(
        folder_devices(&a.c.folder(&f).unwrap().unwrap()),
        vec![a.id.clone()]
    );
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("keep.md"), "x").unwrap();
    a.c.delete_folder(&f).unwrap();
    assert!(path.join("keep.md").exists());
    // PATCH /rest/config is not allowed: ignoring needs a full PUT (§3.3)
    let r =
        a.c.raw(
            tramado_sync::client::Method::Patch,
            "/rest/config",
            Some(&json!({})),
            MINUTE,
        )
        .unwrap();
    assert_eq!(r.status, 405);
}

#[test]
#[ignore]
fn pending_device_provisional_then_folder_share() {
    let a = Raw::new();
    let b = Raw::new();
    let w = World::new();
    let f = new_folder_id(&a.id);
    a.create_folder(&f, &[]);
    w.register(&a, &f);
    w.policy.set(policy(&f)).unwrap();
    // B joins: A as a device, the folder shared with A (the knock carries the offer)
    b.add_device(&a);
    b.create_folder(&f, &[&a.id]);
    let mut adm = Admission::default();
    assert!(
        wait_until(MINUTE, || a
            .c
            .pending_devices()
            .unwrap()
            .contains_key(&b.id)),
        "B knocks"
    );
    adm.handle_pending_devices(&w.ctx(&a)).unwrap();
    let d = a.c.device(&b.id).unwrap().expect("provisional add");
    assert!(d["addresses"]
        .as_array()
        .unwrap()
        .contains(&json!("dynamic")));
    assert!(adm.provisional.contains_key(&b.id));
    assert_eq!(
        folder_devices(&a.c.folder(&f).unwrap().unwrap()),
        vec![a.id.clone()],
        "no folders yet"
    );
    assert!(
        wait_until(MINUTE, || a
            .c
            .pending_folders()
            .unwrap()
            .get(&f)
            .is_some_and(|o| o.contains_key(&b.id))),
        "the offer shows once B is configured"
    );
    adm.handle_pending_folders(&w.ctx(&a)).unwrap();
    assert!(folder_devices(&a.c.folder(&f).unwrap().unwrap()).contains(&b.id));
    assert!(
        wait_until(MINUTE, || b.remote_valid(&f, &a.id)),
        "B sees A share the folder"
    );
    assert!(w
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|e| matches!(e, tramado_sync::SyncEvent::Admitted { .. })));
}

#[test]
#[ignore]
fn outsider_rejected_and_ignored() {
    let a = Raw::new();
    let c = Raw::new();
    let w = World::new();
    let f = new_folder_id(&a.id);
    a.create_folder(&f, &[]);
    w.register(&a, &f);
    w.policy.set(policy(&f)).unwrap();
    // C knows A's device ID and address but not the folder ID: it offers a guess
    c.add_device(&a);
    let guess = new_folder_id(&c.id);
    c.create_folder(&guess, &[&a.id]);
    let mut adm = Admission::default();
    assert!(wait_until(MINUTE, || a
        .c
        .pending_devices()
        .unwrap()
        .contains_key(&c.id)));
    adm.handle_pending_devices(&w.ctx(&a)).unwrap();
    assert!(wait_until(MINUTE, || a
        .c
        .pending_folders()
        .unwrap()
        .contains_key(&guess)));
    adm.on_cluster_config(&c.id, Instant::now() - Duration::from_secs(5));
    adm.handle_pending_folders(&w.ctx(&a)).unwrap();
    assert!(
        adm.early_evictions(&w.ctx(&a)).unwrap(),
        "no proof → evicted"
    );
    adm.apply_ignores(&w.ctx(&a)).unwrap();
    assert!(a.c.device(&c.id).unwrap().is_none());
    let cfg = a.c.config().unwrap();
    let ign = cfg["remoteIgnoredDevices"].as_array().unwrap();
    assert!(ign
        .iter()
        .any(|e| e["deviceID"] == c.id.as_str() && e["name"] == "tramado"));
    assert!(folder_devices(&a.c.folder(&f).unwrap().unwrap()) == vec![a.id.clone()]);
    // an ignored device produces no more pending entries (✔ §9.2)
    std::thread::sleep(Duration::from_secs(3));
    assert!(!a.c.pending_devices().unwrap().contains_key(&c.id));
    assert!(!c.remote_valid(&guess, &a.id));
}

#[test]
#[ignore]
fn event_names_accepted() {
    let a = Raw::new();
    let r =
        a.c.raw(
            tramado_sync::client::Method::Get,
            &format!("/rest/events?events={MASK_A}&since=0&timeout=0"),
            None,
            MINUTE,
        )
        .unwrap();
    assert_eq!(r.status, 200);
    let (since, _) = tramado_sync::events::prime(&a.c);
    let f = new_folder_id(&a.id);
    a.create_folder(&f, &[]);
    a.write(&f, "Aula 1.md", b"# Aula 1\n");
    let mut seen = std::collections::BTreeSet::new();
    let ok = wait_until(MINUTE, || {
        for e in a.c.events(MASK_A, since, 1).unwrap() {
            seen.insert(e.kind);
        }
        [
            "StateChanged",
            "LocalIndexUpdated",
            "FolderSummary",
            "FolderResumed",
        ]
        .iter()
        .all(|k| seen.contains(*k))
    });
    assert!(ok, "seen {seen:?}");
    for k in &seen {
        assert!(MASK_A.split(',').any(|m| m == k), "{k} is in the mask");
    }
    // an unknown name is silently accepted and never fires (§3.5)
    let r =
        a.c.raw(
            tramado_sync::client::Method::Get,
            "/rest/events?events=DevicePendingDetected&since=0&timeout=0",
            None,
            MINUTE,
        )
        .unwrap();
    assert_eq!(r.status, 200);
}

#[test]
#[ignore]
fn modified_by_after_foreign_write() {
    let a = Raw::new();
    let b = Raw::new();
    let f = shared_pair(&a, &b);
    let path = format!(".tramado/members/{}.json", a.id);
    a.write(&f, &path, b"{\"a\":1}");
    assert!(wait_until(MINUTE, || b.has(&f, &path, b"{\"a\":1}")));
    let (since, disk) = tramado_sync::events::prime(&a.c);
    let _ = since;
    // B overwrites A's file: the forgery reaches A with B's ShortId
    b.write(&f, &path, b"{\"forged\":1}");
    assert!(wait_until(MINUTE, || a.has(&f, &path, b"{\"forged\":1}")));
    let info = a.c.db_file(&f, &path).unwrap().unwrap();
    assert_eq!(
        info.local.unwrap().modified_by.as_deref(),
        Some(ids::short_id(&b.id))
    );
    let ev = a.c.disk_events(disk, 2).unwrap();
    let rc = ev
        .iter()
        .find(|e| e.kind == "RemoteChangeDetected" && e.data["path"] == path.as_str())
        .expect("event");
    assert_eq!(rc.data["modifiedBy"], ids::short_id(&b.id));
    assert_eq!(rc.data["action"], "modified");
}

#[test]
#[ignore]
fn modified_by_after_foreign_delete() {
    let a = Raw::new();
    let b = Raw::new();
    let f = shared_pair(&a, &b);
    let path = format!(".tramado/members/{}.json", a.id);
    a.write(&f, &path, b"{\"a\":1}");
    assert!(wait_until(MINUTE, || b.has(&f, &path, b"{\"a\":1}")));
    std::fs::remove_file(b.folder_path(&f).join(&path)).unwrap();
    b.c.scan(&f, Some(&path)).unwrap();
    assert!(wait_until(MINUTE, || !a
        .folder_path(&f)
        .join(&path)
        .exists()));
    let info = a.c.db_file(&f, &path).unwrap().unwrap();
    let l = info.local.unwrap();
    assert!(l.deleted);
    assert_eq!(l.modified_by.as_deref(), Some(ids::short_id(&b.id)));
    let g = info.global.unwrap();
    assert!(g.deleted && g.modified_by.as_deref() == Some(ids::short_id(&b.id)));
}

#[test]
#[ignore]
fn blocks_hash_27b_and_1mib() {
    let a = Raw::new();
    let f = new_folder_id(&a.id);
    a.create_folder(&f, &[]);
    let small = b"{\"format\":\"tramado\",\"v\":12}";
    assert_eq!(small.len(), 27);
    let big: Vec<u8> = (0..(1u32 << 20)).map(|i| (i % 251) as u8).collect();
    a.write(&f, "small.json", small);
    a.write(&f, "big.bin", &big);
    let s =
        a.c.db_file(&f, "small.json")
            .unwrap()
            .unwrap()
            .local
            .unwrap();
    assert_eq!(s.blocks_hash.as_deref(), Some(blocks_hash(small).as_str()));
    {
        use base64::Engine as _;
        use sha2::{Digest, Sha256};
        let twice =
            base64::engine::general_purpose::STANDARD.encode(Sha256::digest(Sha256::digest(small)));
        assert_eq!(
            s.blocks_hash.as_deref(),
            Some(twice.as_str()),
            "27 B = base64(SHA-256(SHA-256(bytes)))"
        );
    }
    let l = a.c.db_file(&f, "big.bin").unwrap().unwrap().local.unwrap();
    assert_eq!(
        l.blocks_hash.as_deref(),
        Some(blocks_hash(&big).as_str()),
        "8 blocks of 128 KiB"
    );
    assert_eq!(l.size, Some(1 << 20));
}

#[test]
#[ignore]
fn disk_event_shapes_and_availability() {
    let a = Raw::new();
    let b = Raw::new();
    let f = shared_pair(&a, &b);
    let (_, disk_b) = tramado_sync::events::prime(&b.c);
    a.write(&f, "Aulas/Aula 1/notes.md", b"x");
    assert!(wait_until(MINUTE, || b.has(
        &f,
        "Aulas/Aula 1/notes.md",
        b"x"
    )));
    let ev = b.c.disk_events(disk_b, 2).unwrap();
    let file = ev
        .iter()
        .find(|e| e.kind == "RemoteChangeDetected" && e.data["type"] == "file")
        .expect("a file event");
    for k in [
        "action",
        "folder",
        "folderID",
        "label",
        "modifiedBy",
        "path",
        "type",
    ] {
        assert!(!file.data[k].is_null(), "{k}");
    }
    assert_eq!(
        to_class_path(file.data["path"].as_str().unwrap()),
        "Aulas/Aula 1/notes.md"
    );
    assert_eq!(
        file.data["action"], "modified",
        "a new file reports modified"
    );
    assert!(
        ev.iter().any(|e| e.data["type"] == "dir"),
        "parents arrive as dir events"
    );
    // availability: the other device holds it, never this one
    let info = b.c.db_file(&f, "Aulas/Aula 1/notes.md").unwrap().unwrap();
    assert_eq!(info.availability, vec![(a.id.clone(), false)]);
    assert!(wait_until(MINUTE, || {
        let mine = a.c.db_file(&f, "Aulas/Aula 1/notes.md").unwrap().unwrap();
        mine.holders().contains(&b.id) && !mine.holders().contains(&a.id)
    }));
    // local deletion shape
    let (_, disk_a) = tramado_sync::events::prime(&a.c);
    std::fs::remove_file(a.folder_path(&f).join("Aulas/Aula 1/notes.md")).unwrap();
    a.c.scan(&f, Some("Aulas/Aula 1/notes.md")).unwrap();
    let ev = a.c.disk_events(disk_a, 2).unwrap();
    let del = ev
        .iter()
        .find(|e| e.kind == "LocalChangeDetected" && e.data["type"] == "file")
        .expect("local");
    assert_eq!(del.data["action"], "deleted");
}

#[test]
#[ignore]
fn ignored_folders_patch_shape() {
    let a = Raw::new();
    let b = Raw::new();
    a.add_device(&b);
    b.add_device(&a);
    let f = new_folder_id(&b.id);
    let now = "2026-11-04T10:00:00Z";
    a.c.patch_device(
        &b.id,
        &json!({"ignoredFolders": [{"id": f, "label": "TGDC", "time": now}]}),
    )
    .unwrap();
    let d = a.c.device(&b.id).unwrap().unwrap();
    assert_eq!(d["ignoredFolders"][0]["id"], f.as_str());
    assert_eq!(d["ignoredFolders"][0]["label"], "TGDC");
    // B offers it: A does not list the offer (the per-class refusal works, §25 Q7)
    let g = new_folder_id(&b.id);
    b.create_folder(&f, &[&a.id]);
    b.create_folder(&g, &[&a.id]);
    assert!(
        wait_until(MINUTE, || a.c.pending_folders().unwrap().contains_key(&g)),
        "a control offer arrives"
    );
    assert!(
        !a.c.pending_folders().unwrap().contains_key(&f),
        "the ignored folder is never pending"
    );
    // the shape survives a full config round trip (apply_bans writes it with PUT)
    let cfg = a.c.config().unwrap();
    a.c.put_config(&cfg).unwrap();
    assert_eq!(
        a.c.device(&b.id).unwrap().unwrap()["ignoredFolders"][0]["id"],
        f.as_str()
    );
}

#[test]
#[ignore]
fn reset_restores_local_mass_delete() {
    let a = Raw::new();
    let mut a = a;
    let b = Raw::new();
    let f = shared_pair(&a, &b);
    for i in 0..30 {
        a.write(
            &f,
            &format!("Docs/{i:02}.md"),
            format!("doc {i}").as_bytes(),
        );
    }
    assert!(wait_until(MINUTE, || (0..30).all(|i| b.has(
        &f,
        &format!("Docs/{i:02}.md"),
        format!("doc {i}").as_bytes()
    ))));
    // the guard pauses at the first local deletion (here: before deleting)
    a.c.patch_folder(&f, &json!({"paused": true})).unwrap();
    std::fs::remove_dir_all(a.folder_path(&f).join("Docs")).unwrap();
    // restore: reset → exit 3 → respawn (paused) → unpause → pulled back from B
    a.c.reset_folder(&f).unwrap();
    assert_eq!(
        a.wait_exit(Duration::from_secs(30)),
        Some(3),
        "Syncthing exits with code 3 after a reset"
    );
    a.start();
    assert_eq!(
        a.c.folder(&f).unwrap().unwrap()["paused"],
        true,
        "still paused after the respawn"
    );
    a.c.patch_folder(&f, &json!({"paused": false})).unwrap();
    assert!(
        wait_until(Duration::from_secs(90), || (0..30).all(|i| a.has(
            &f,
            &format!("Docs/{i:02}.md"),
            format!("doc {i}").as_bytes()
        ))),
        "every file came back"
    );
    assert!(
        (0..30).all(|i| b.has(
            &f,
            &format!("Docs/{i:02}.md"),
            format!("doc {i}").as_bytes()
        )),
        "the peer never applied the deletion"
    );
}

#[test]
#[ignore]
fn paused_in_config_sends_nothing() {
    let mut a = Raw::new();
    let b = Raw::new();
    let f = shared_pair(&a, &b);
    assert!(a.stop().is_some());
    // a change made while the app was closed
    std::fs::write(a.folder_path(&f).join("while-closed.md"), "x").unwrap();
    // pre-spawn pauses every class folder in config.xml
    a.start();
    assert_eq!(a.c.folder(&f).unwrap().unwrap()["paused"], true);
    std::thread::sleep(Duration::from_secs(4));
    assert!(
        !b.folder_path(&f).join("while-closed.md").exists(),
        "nothing was sent while paused"
    );
    a.c.patch_folder(&f, &json!({"paused": false})).unwrap();
    assert!(wait_until(MINUTE, || b.has(&f, "while-closed.md", b"x")));
}

#[test]
#[ignore]
fn sign_with_key_pem_verifies_with_cert() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("syncthing");
    let inst = init::create_identity(&bin(), &home).unwrap();
    let class = new_folder_id(&inst.device_id);
    let path = format!(".tramado/bans/{}.json", inst.device_id);
    let canonical = br#"{"entries":[],"format":"tramado.bans","version":1}"#;
    let sig = sign::sign(&home, &class, &path, canonical).unwrap();
    assert!(sign::verify(
        &sig,
        &inst.device_id,
        &class,
        &path,
        canonical
    ));
    assert!(
        !sign::verify(
            &sig,
            &inst.device_id,
            &class,
            ".tramado/bans/other.json",
            canonical
        ),
        "path-bound"
    );
    assert!(
        !sign::verify(&sig, &inst.device_id, &new_folder_id("x"), &path, canonical),
        "class-bound"
    );
    assert!(!sign::verify(&sig, &inst.device_id, &class, &path, b"{}"));
    use base64::Engine as _;
    let der = base64::engine::general_purpose::STANDARD
        .decode(&sig.cert)
        .unwrap();
    assert_eq!(
        ids::device_id_from_cert_der(&der),
        inst.device_id,
        "cert.pem is the device identity"
    );
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(&sig.value)
            .unwrap()
            .len(),
        64
    );
}

#[test]
#[ignore]
fn shutdown_one_then_other_within_budget() {
    let a = Node::new("Ana");
    let b = Node::new("Bruno");
    let class = a.local_class("TGDC");
    a.engine.share_class(&class, "TGDC").unwrap();
    a.push(policy(&class));
    b.engine
        .join_class(tramado_sync::JoinRequest {
            code: a.invite(&class),
            dir_name: "TGDC".into(),
            parent: None,
            include_audio: true,
        })
        .unwrap();
    assert!(wait_until(MINUTE, || b.saw(|e| matches!(
        e,
        tramado_sync::SyncEvent::AdmittedMe { .. }
    ))));
    let pid_a = tramado_sync::supervisor::read_runtime(&a.paths.syncthing_home())
        .unwrap()
        .pid;
    let pid_b = tramado_sync::supervisor::read_runtime(&b.paths.syncthing_home())
        .unwrap()
        .pid;
    let t = Instant::now();
    a.engine.stop(Duration::from_secs(5));
    assert!(
        t.elapsed() < Duration::from_secs(7),
        "A stopped in {:?}",
        t.elapsed()
    );
    let t = Instant::now();
    b.engine.stop(Duration::from_secs(5));
    assert!(
        t.elapsed() < Duration::from_secs(7),
        "B stopped in {:?}",
        t.elapsed()
    );
    assert!(
        !tramado_sync::supervisor::pid_alive(pid_a) && !tramado_sync::supervisor::pid_alive(pid_b)
    );
    assert!(
        !a.paths.syncthing_home().join("runtime.json").exists(),
        "a clean stop deletes runtime.json"
    );
}
