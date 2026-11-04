// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Two `SyncEngine`s on loopback, each with its own data dir (sync spec §24 two-instance e2e,
//! plan §3.2). `#[ignore]`; run with `npm run test:contract`.

mod common;

use std::time::{Duration, Instant};

use common::*;
use tramado_base::error::Code;
use tramado_base::ids;
use tramado_sync::client::folder_devices;
use tramado_sync::{
    JoinRequest, LeaveAfterwards, LeaveOptions, RemoteAction, SyncEvent, SyncState,
};

const MINUTE: Duration = Duration::from_secs(60);

fn join_request(code: String) -> JoinRequest {
    JoinRequest {
        code,
        dir_name: "TGDC".into(),
        parent: None,
        include_audio: true,
    }
}

/// Ana shares a class, pushes its policy; Bruno joins with her invite and is admitted.
fn pair() -> (Node, Node, String) {
    let a = Node::new("Ana");
    let b = Node::new("Bruno");
    let class = a.local_class("TGDC");
    a.engine.share_class(&class, "TGDC").unwrap();
    a.push(policy(&class));
    b.engine.join_class(join_request(a.invite(&class))).unwrap();
    assert!(
        wait_until(MINUTE, || b
            .saw(|e| matches!(e, SyncEvent::AdmittedMe { .. }))),
        "Bruno was admitted"
    );
    assert!(wait_until(MINUTE, || b.root(&class).is_dir()));
    (a, b, class)
}

#[test]
#[ignore]
fn invite_join_admitted_within_10s() {
    let a = Node::new("Ana");
    let b = Node::new("Bruno");
    let class = a.local_class("TGDC");
    let e = a.engine.share_class(&class, "TGDC").unwrap();
    assert!(e.shared);
    assert_eq!(a.engine.status().state, SyncState::Running);
    a.push(policy(&class));
    let t = Instant::now();
    let entry = b.engine.join_class(join_request(a.invite(&class))).unwrap();
    assert!(entry.joining && entry.shared);
    assert!(
        wait_until(Duration::from_secs(10), || {
            b.saw(|e| matches!(e, SyncEvent::AdmittedMe { class_id, by_device } if *class_id == class && *by_device == a.id))
        }),
        "admitted after {:?}",
        t.elapsed()
    );
    eprintln!("admitted in {:?}", t.elapsed());
    assert!(a.saw(|e| matches!(e, SyncEvent::Admitted { device_id, .. } if *device_id == b.id)));
    // while joining, Bruno's device announces "<person> (<computer>)" (§9.4); Ana stays "Tramado"
    let cb = node_client(&b);
    assert_eq!(cb.device(&b.id).unwrap().unwrap()["name"], "Bruno (test)");
    let ca = node_client(&a);
    assert_eq!(ca.device(&a.id).unwrap().unwrap()["name"], "Tramado");
    // class identity confirmed (TS sets joining false): the name goes back to "Tramado"
    b.registry.update(&class, |e| e.joining = false).unwrap();
    assert!(wait_until(MINUTE, || cb.device(&b.id).unwrap().unwrap()
        ["name"]
        == "Tramado"));
    // a second join of the same class is refused
    let again = b
        .engine
        .join_class(join_request(a.invite(&class)))
        .unwrap_err();
    assert_eq!(again.code(), Code::Conflict);
}

#[test]
#[ignore]
fn join_devices_unpaused_after_folder() {
    let (a, b, class) = pair();
    let cb = node_client(&b);
    let dev = cb.device(&a.id).unwrap().unwrap();
    assert_eq!(
        dev["paused"], false,
        "the invite device was resumed after the folder existed"
    );
    assert_eq!(dev["introducer"], false);
    assert!(dev["addresses"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x == "dynamic"));
    let f = cb.folder(&class).unwrap().unwrap();
    assert_eq!(f["paused"], false);
    assert_eq!(folder_devices(&f), vec![b.id.clone(), a.id.clone()]);
    assert_eq!(f["pullerDelayS"], 0);
    // the first knock carried the offer: Ana never ignored Bruno
    let ca = node_client(&a);
    let cfg = ca.config().unwrap();
    assert!(cfg["remoteIgnoredDevices"].as_array().unwrap().is_empty());
    assert!(folder_devices(&ca.folder(&class).unwrap().unwrap()).contains(&b.id));
    let ign = cb.ignores(&class).unwrap();
    assert_eq!(ign[0], "// Tramado managed ignores (v1)");
    assert!(
        !ign.iter().any(|l| l.contains("audio.webm")),
        "audio included"
    );
}

#[test]
#[ignore]
fn file_and_chat_line_cross_with_modified_by() {
    let (a, b, class) = pair();
    let doc = "Documentos/Aula 1 — resumo.md";
    let t = Instant::now();
    a.fs.write(&class, doc, b"# Aula 1\n", false).unwrap();
    assert!(wait_until(MINUTE, || b.file(&class, doc).as_deref()
        == Some(b"# Aula 1\n".as_slice())));
    eprintln!("document crossed in {:?}", t.elapsed());
    let info = b.engine.file_info(&class, &[doc.to_string()]).unwrap();
    assert_eq!(
        info[0].local_modified_by.as_deref(),
        Some(ids::short_id(&a.id))
    );
    assert!(!info[0].local_deleted);
    assert!(b.saw(|e| matches!(e, SyncEvent::RemoteChange { path, action: RemoteAction::Modified, modified_by, .. }
        if path == doc && modified_by == ids::short_id(&a.id))));
    let chat = format!(".tramado/chat/{}/2026-11.jsonl", b.id);
    let line = b"{\"id\":\"01JBX\",\"text\":\"ol\xc3\xa1\"}\n";
    let t = Instant::now();
    b.fs.append(&class, &chat, line, true).unwrap();
    assert!(wait_until(MINUTE, || a.file(&class, &chat).as_deref()
        == Some(line.as_slice())));
    eprintln!("chat line crossed in {:?}", t.elapsed());
    let info = a
        .engine
        .file_info(&class, std::slice::from_ref(&chat))
        .unwrap();
    assert_eq!(
        info[0].local_modified_by.as_deref(),
        Some(ids::short_id(&b.id))
    );
    // "✓ Sent": the sender sees the receiver in availability
    assert!(b
        .engine
        .wait_available(&class, &chat, 1, Duration::from_secs(30))
        .unwrap());
    let caught = a
        .engine
        .wait_caught_up(&class, Duration::from_secs(30))
        .unwrap();
    assert!(caught.complete, "{caught:?}");
}

#[test]
#[ignore]
fn self_heal_restores_forged_member_file() {
    let (a, b, class) = pair();
    let mine = format!(".tramado/members/{}.json", a.id);
    a.write_member_file(&class);
    let original = a.file(&class, &mine).unwrap();
    assert!(wait_until(MINUTE, || b.file(&class, &mine).as_deref()
        == Some(original.as_slice())));
    // Bruno forges Ana's member file with a file manager
    std::fs::write(
        b.root(&class).join(&mine),
        b"{\"me\":false,\"forged\":true}\n",
    )
    .unwrap();
    b.engine.scan(&class, Some(&mine)).unwrap();
    assert!(
        wait_until(MINUTE, || a.saw(
            |e| matches!(e, SyncEvent::ForeignWrite { path, healed: true, modified_by, .. }
            if *path == mine && modified_by == ids::short_id(&b.id))
        )),
        "Ana healed her file"
    );
    assert_eq!(a.file(&class, &mine).unwrap(), original);
    assert!(
        wait_until(MINUTE, || b.file(&class, &mine).as_deref()
            == Some(original.as_slice())),
        "the healed version reached Bruno"
    );
}

#[test]
#[ignore]
fn foreign_delete_is_restored() {
    let (a, b, class) = pair();
    let mine = format!(".tramado/members/{}.json", a.id);
    a.write_member_file(&class);
    let original = a.file(&class, &mine).unwrap();
    assert!(wait_until(MINUTE, || b.file(&class, &mine).is_some()));
    std::fs::remove_file(b.root(&class).join(&mine)).unwrap();
    b.engine.scan(&class, Some(&mine)).unwrap();
    assert!(wait_until(MINUTE, || a.saw(
        |e| matches!(e, SyncEvent::ForeignWrite { path, healed: true, .. } if *path == mine)
    )));
    assert_eq!(a.file(&class, &mine).unwrap(), original);
    assert!(wait_until(MINUTE, || b.file(&class, &mine).as_deref()
        == Some(original.as_slice())));
    // a deletion Ana makes herself is never undone
    a.fs.remove(&class, &mine, false).unwrap();
    assert!(wait_until(MINUTE, || b.file(&class, &mine).is_none()));
    std::thread::sleep(Duration::from_secs(2));
    assert!(a.file(&class, &mine).is_none());
}

#[test]
#[ignore]
fn leave_waits_until_a_peer_has_the_deletion() {
    let (a, b, class) = pair();
    let bruno = format!(".tramado/members/{}.json", b.id);
    b.write_member_file(&class);
    assert!(wait_until(MINUTE, || a.file(&class, &bruno).is_some()));
    // Ana goes offline; Bruno leaves
    a.engine.stop(Duration::from_secs(5));
    b.fs.remove(&class, &bruno, false).unwrap();
    b.engine
        .leave_class(
            &class,
            LeaveOptions {
                afterwards: LeaveAfterwards::KeepLocal,
            },
        )
        .unwrap();
    std::thread::sleep(Duration::from_secs(5));
    let e = b.registry.get(&class).unwrap();
    assert!(
        e.leaving.is_some() && e.shared,
        "still leaving: nobody holds the deletion"
    );
    assert!(node_client(&b).folder(&class).unwrap().is_some());
    // Ana comes back: the deletion reaches her, then Bruno's folder goes
    a.engine.start().unwrap();
    assert!(
        wait_until(Duration::from_secs(90), || b
            .registry
            .left_classes()
            .contains(&class)),
        "finished leaving"
    );
    let e = b.registry.get(&class).unwrap();
    assert!(
        !e.shared && e.leaving.is_none(),
        "kept as a local class (the app forks it)"
    );
    assert!(node_client(&b).folder(&class).unwrap().is_none());
    assert!(a.file(&class, &bruno).is_none());
    assert!(
        b.root(&class).join("Documentos").exists() || b.root(&class).is_dir(),
        "files stay"
    );
}

#[test]
#[ignore]
fn ban_stops_sync_with_banned_device() {
    let (a, b, class) = pair();
    a.fs.write(&class, "before.md", b"1", false).unwrap();
    assert!(wait_until(MINUTE, || b.file(&class, "before.md").is_some()));
    let mut p = policy(&class);
    p.banned_devices = vec![b.id.clone()];
    a.push(p);
    let ca = node_client(&a);
    assert!(!folder_devices(&ca.folder(&class).unwrap().unwrap()).contains(&b.id));
    let cfg = ca.config().unwrap();
    assert!(
        cfg["remoteIgnoredDevices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["deviceID"] == b.id.as_str() && e["name"] == "tramado-ban"),
        "banned in every class it is in → ignored device-wide"
    );
    b.fs.write(&class, "after-ban.md", b"2", false).unwrap();
    a.fs.write(&class, "ana-after-ban.md", b"3", false).unwrap();
    std::thread::sleep(Duration::from_secs(6));
    assert!(a.file(&class, "after-ban.md").is_none());
    assert!(b.file(&class, "ana-after-ban.md").is_none());
    // unban: the effects go (the person can rejoin with the invite)
    a.push(policy(&class));
    let cfg = ca.config().unwrap();
    assert!(cfg["remoteIgnoredDevices"].as_array().unwrap().is_empty());
}

#[test]
#[ignore]
fn ask_mode_queues_then_admit() {
    let a = Node::new("Ana");
    let b = Node::new("Bruno");
    let class = a.local_class("TGDC");
    a.engine.share_class(&class, "TGDC").unwrap();
    let mut p = policy(&class);
    p.ask_before_admit = true;
    a.push(p);
    b.engine.join_class(join_request(a.invite(&class))).unwrap();
    assert!(
        wait_until(MINUTE, || {
            a.saw(|e| matches!(e, SyncEvent::JoinRequest { request } if request.device_id == b.id && request.name == "Bruno (test)"))
        }),
        "Ana is asked"
    );
    let snap = a.engine.snapshot().unwrap();
    assert_eq!(snap.join_requests.len(), 1);
    assert!(!folder_devices(&node_client(&a).folder(&class).unwrap().unwrap()).contains(&b.id));
    assert!(!b.saw(|e| matches!(e, SyncEvent::AdmittedMe { .. })));
    a.engine.admit(&class, &b.id).unwrap();
    assert!(wait_until(MINUTE, || b
        .saw(|e| matches!(e, SyncEvent::AdmittedMe { .. }))));
    assert!(
        a.saw(|e| matches!(e, SyncEvent::JoinRequestGone { device_id, .. } if *device_id == b.id))
    );
}

#[test]
#[ignore]
fn admit_refused_without_pending_offer() {
    let a = Node::new("Ana");
    let class = a.local_class("TGDC");
    a.engine.share_class(&class, "TGDC").unwrap();
    a.push(policy(&class));
    let stranger = "5QDNN46-YHG4AH2-3NWSGYW-RYXVGJP-JORVLZ4-3VGOMPY-S5KL2O6-AXZBAQE";
    let e = a.engine.admit(&class, stranger).unwrap_err();
    assert_eq!(e.code(), Code::PermissionDenied);
    assert!(
        !folder_devices(&node_client(&a).folder(&class).unwrap().unwrap())
            .contains(&stranger.to_string())
    );
    let other = a.local_class("Other");
    assert_eq!(
        a.engine.admit(&other, stranger).unwrap_err().code(),
        Code::NotFound,
        "not shared"
    );
    assert_eq!(
        a.engine.admit(&class, "nope").unwrap_err().code(),
        Code::Invalid
    );
}
