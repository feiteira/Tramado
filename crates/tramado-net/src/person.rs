// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The person key (folder spec §2.1, §8.3.1, architecture §5.2 `person`): an Ed25519 key created
//! at onboarding and kept in `Secrets` (internal name `person`, base64url of the 32-byte seed).
//! It signs only bindings of **this** device to the person, so a webview script cannot bind a
//! foreign device: `person_prove` takes a class ID only, and the device is the one Rust knows.

use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::ids;

use crate::secrets::{Secrets, PERSON};

/// TS `PersonInfo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonInfo {
    pub member_id: String,
    /// base64url public key
    #[serde(rename = "pub")]
    pub pub_b64url: String,
}

/// TS `PersonProof`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonProof {
    /// base64url public key
    #[serde(rename = "pub")]
    pub pub_b64url: String,
    /// base64url Ed25519 signature
    pub sig: String,
}

/// The message a person proof signs (folder spec §8.3.1).
pub fn proof_message(class_id: &str, device_id: &str, member_id: &str) -> String {
    format!("tramado-member-v1|{class_id}|{device_id}|{member_id}")
}

pub struct Person {
    secrets: Arc<Secrets>,
    /// Serialises the first-call creation.
    lock: Mutex<()>,
}

fn info_of(key: &SigningKey) -> PersonInfo {
    let public = key.verifying_key().to_bytes();
    PersonInfo {
        member_id: ids::member_id(&public),
        pub_b64url: URL_SAFE_NO_PAD.encode(public),
    }
}

impl Person {
    pub fn new(secrets: Arc<Secrets>) -> Self {
        Person {
            secrets,
            lock: Mutex::new(()),
        }
    }

    fn load(&self) -> AppResult<Option<SigningKey>> {
        let Some(text) = self.secrets.get(PERSON)? else {
            return Ok(None);
        };
        let bytes = URL_SAFE_NO_PAD
            .decode(text.trim())
            .map_err(|_| AppError::new(Code::IoError, "the stored person key is unreadable"))?;
        let seed: [u8; 32] = bytes
            .try_into()
            .map_err(|_| AppError::new(Code::IoError, "the stored person key is unreadable"))?;
        Ok(Some(SigningKey::from_bytes(&seed)))
    }

    /// Creates the person key on the first call (32 bytes from the OS RNG); returns its member
    /// ID and public key. Later calls return the same key.
    pub fn init(&self) -> AppResult<PersonInfo> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(key) = self.load()? {
            return Ok(info_of(&key));
        }
        let mut seed = [0u8; 32];
        ids::try_fill_random(&mut seed)
            .map_err(|e| AppError::new(Code::IoError, format!("no randomness: {e}")))?;
        let key = SigningKey::from_bytes(&seed);
        self.secrets.put(PERSON, &URL_SAFE_NO_PAD.encode(seed))?;
        Ok(info_of(&key))
    }

    /// The person's identity, if the key exists.
    pub fn info(&self) -> AppResult<Option<PersonInfo>> {
        Ok(self.load()?.map(|k| info_of(&k)))
    }

    /// Proves that `device_id` belongs to the person, for `class_id`. The caller passes **this**
    /// device's ID (see [`Person::prove_own`]); `NOT_FOUND` before `init`.
    pub fn prove(&self, class_id: &str, device_id: &str) -> AppResult<PersonProof> {
        if !ids::is_class_id(class_id) {
            return Err(AppError::invalid("bad class id"));
        }
        if !ids::is_device_id(device_id) {
            return Err(AppError::invalid("bad device id"));
        }
        let key = self
            .load()?
            .ok_or_else(|| AppError::not_found("no person key yet (onboarding)"))?;
        let info = info_of(&key);
        let msg = proof_message(class_id, device_id, &info.member_id);
        let sig = key.sign(msg.as_bytes());
        Ok(PersonProof {
            pub_b64url: info.pub_b64url,
            sig: URL_SAFE_NO_PAD.encode(sig.to_bytes()),
        })
    }

    /// `person_prove`: binds the device Rust knows as this one (`ClassFs::device`), never a
    /// device named by the caller; `SYNC_UNAVAILABLE` before the sync identity exists.
    pub fn prove_own(&self, class_id: &str, own_device: Option<&str>) -> AppResult<PersonProof> {
        let device = own_device.ok_or_else(|| {
            AppError::new(
                Code::SyncUnavailable,
                "this computer has no device identity yet",
            )
        })?;
        self.prove(class_id, device)
    }

    /// The seed, for pairing a second computer (v1.1). Crate-internal.
    #[allow(dead_code)]
    pub(crate) fn seed(&self) -> AppResult<Option<[u8; 32]>> {
        Ok(self.load()?.map(|k| k.to_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    const CLASS: &str = "tramado-mde5jfv46prdf2fjxvmbjr4242";
    const DEVICE: &str = "WSGDTBE-PYLFPIJ-JSGOJZC-CJC6O2N-ARA52TT-HKVPG6S-UVZH2AZ-RUULKAI";
    const OTHER: &str = "TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT";

    fn vectors() -> serde_json::Value {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../test-vectors/ids.json");
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    fn with_seed(seed_hex: &str) -> (tempfile::TempDir, Person) {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(Secrets::new(dir.path(), true));
        let seed: Vec<u8> = (0..32)
            .map(|i| u8::from_str_radix(&seed_hex[i * 2..i * 2 + 2], 16).unwrap())
            .collect();
        secrets.put(PERSON, &URL_SAFE_NO_PAD.encode(seed)).unwrap();
        (dir, Person::new(secrets))
    }

    fn verify(proof: &PersonProof, class: &str, device: &str, member: &str) -> bool {
        let public: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&proof.pub_b64url)
            .unwrap()
            .try_into()
            .unwrap();
        let sig: [u8; 64] = URL_SAFE_NO_PAD
            .decode(&proof.sig)
            .unwrap()
            .try_into()
            .unwrap();
        VerifyingKey::from_bytes(&public)
            .unwrap()
            .verify(
                proof_message(class, device, member).as_bytes(),
                &Signature::from_bytes(&sig),
            )
            .is_ok()
    }

    #[test]
    fn member_id_from_pub() {
        let v = vectors();
        for m in v["memberId"].as_array().unwrap() {
            let (_d, p) = with_seed(m["testOnlySeedHex"].as_str().unwrap());
            let info = p.init().unwrap();
            assert_eq!(info.member_id, m["memberId"].as_str().unwrap());
            assert_eq!(info.pub_b64url, m["pubB64u"].as_str().unwrap());
            assert_eq!(p.info().unwrap(), Some(info.clone()));
            let json = serde_json::to_value(&info).unwrap();
            assert_eq!(json["memberId"], m["memberId"]);
            assert_eq!(json["pub"], m["pubB64u"]);
        }
    }

    #[test]
    fn init_creates_once() {
        let dir = tempfile::tempdir().unwrap();
        let p = Person::new(Arc::new(Secrets::new(dir.path(), true)));
        assert_eq!(p.info().unwrap(), None);
        assert_eq!(p.prove(CLASS, DEVICE).unwrap_err().code(), Code::NotFound);
        let a = p.init().unwrap();
        let b = p.init().unwrap();
        assert_eq!(a, b);
        assert!(ids::is_member_id(&a.member_id));
        assert_eq!(a.pub_b64url.len(), 43);
        assert!(p.seed().unwrap().is_some());
    }

    #[test]
    fn prove_signs_only_own_device() {
        let v = vectors();
        let pp = &v["personProof"];
        let (_d, p) = with_seed("0101010101010101010101010101010101010101010101010101010101010101");
        // The IPC path names no device: without a device identity there is nothing to sign.
        assert_eq!(
            p.prove_own(CLASS, None).unwrap_err().code(),
            Code::SyncUnavailable
        );
        let proof = p.prove_own(CLASS, Some(DEVICE)).unwrap();
        // Byte-exact with the shared vector (Ed25519 is deterministic).
        assert_eq!(proof.pub_b64url, pp["person"]["pub"].as_str().unwrap());
        assert_eq!(proof.sig, pp["person"]["sig"].as_str().unwrap());
        let member = pp["memberId"].as_str().unwrap();
        assert!(verify(&proof, CLASS, DEVICE, member));
        // The proof binds this device only: it does not verify for another one.
        assert!(!verify(&proof, CLASS, OTHER, member));
        assert!(!verify(
            &proof,
            "tramado-wp4vuizadsrm5cjkgpv2ewpwuv",
            DEVICE,
            member
        ));
        for (class, device) in [("bad", DEVICE), (CLASS, "AB4Z76W"), (CLASS, "")] {
            assert_eq!(
                p.prove(class, device).unwrap_err().code(),
                Code::Invalid,
                "{class} {device}"
            );
        }
    }
}
