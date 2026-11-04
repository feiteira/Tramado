// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Device signatures (sync spec §12.4, folder spec §6.6). Rust holds the device key
//! (`<home>/key.pem`, PKCS#8 Ed25519) and never exposes it; the signed message is
//! `"tramado-sig-v1" 0x00 classId 0x00 path 0x00 canonical`, prefixed here, so the key can only
//! ever sign Tramado records of a class path. Works without the daemon.

use std::path::Path;

use base64::Engine as _;
use ed25519_dalek::pkcs8::DecodePrivateKey;
use ed25519_dalek::{Signer, SigningKey};
use tramado_base::confine;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::ids;

use crate::types::Sig;

pub const DOMAIN: &str = "tramado-sig-v1";

/// The exact message of folder spec §6.6.
pub fn message(class_id: &str, path: &str, canonical: &[u8]) -> Vec<u8> {
    let mut m =
        Vec::with_capacity(DOMAIN.len() + class_id.len() + path.len() + canonical.len() + 3);
    m.extend_from_slice(DOMAIN.as_bytes());
    m.push(0);
    m.extend_from_slice(class_id.as_bytes());
    m.push(0);
    m.extend_from_slice(path.as_bytes());
    m.push(0);
    m.extend_from_slice(canonical);
    m
}

/// The DER of the first PEM block of `text` with the given label.
pub fn pem_der(text: &str, label: &str) -> Option<Vec<u8>> {
    let begin = format!("-----BEGIN {label}-----");
    let end = format!("-----END {label}-----");
    let a = text.find(&begin)? + begin.len();
    let b = text[a..].find(&end)? + a;
    let b64: String = text[a..b].chars().filter(|c| !c.is_whitespace()).collect();
    base64::engine::general_purpose::STANDARD.decode(b64).ok()
}

fn unavailable(msg: &str) -> AppError {
    AppError::new(Code::SyncUnavailable, msg.to_string())
}

/// Signs a canonical record of `class_id`/`path` with the device key in `home`.
pub fn sign(home: &Path, class_id: &str, path: &str, canonical: &[u8]) -> AppResult<Sig> {
    if !ids::is_class_id(class_id) {
        return Err(AppError::invalid("not a class ID"));
    }
    confine::validate_class_path(path)?;
    if canonical.is_empty() || canonical.len() > 1 << 20 {
        return Err(AppError::invalid("the record must be 1 byte to 1 MiB"));
    }
    let key_pem = std::fs::read_to_string(home.join("key.pem"))
        .map_err(|_| unavailable("this computer has no sharing identity yet"))?;
    let cert_pem = std::fs::read_to_string(home.join("cert.pem"))
        .map_err(|_| unavailable("this computer has no sharing identity yet"))?;
    let key = SigningKey::from_pkcs8_pem(&key_pem)
        .map_err(|_| unavailable("the device key is not an Ed25519 key"))?;
    let cert =
        pem_der(&cert_pem, "CERTIFICATE").ok_or_else(|| unavailable("cert.pem is damaged"))?;
    let sig = key.sign(&message(class_id, path, canonical));
    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(Sig {
        cert: b64.encode(&cert),
        value: b64.encode(sig.to_bytes()),
    })
}

/// The Ed25519 public key inside a certificate DER (folder spec §6.6 step 2): the 32 bytes
/// after the single SubjectPublicKeyInfo prefix `30 2a 30 05 06 03 2b 65 70 03 21 00`.
pub fn cert_public_key(der: &[u8]) -> Option<[u8; 32]> {
    const PREFIX: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    let hits: Vec<usize> = der
        .windows(PREFIX.len())
        .enumerate()
        .filter(|(_, w)| *w == PREFIX)
        .map(|(i, _)| i)
        .collect();
    if hits.len() != 1 {
        return None;
    }
    let at = hits[0] + PREFIX.len();
    der.get(at..at + 32)?.try_into().ok()
}

/// Verification as every reader does it (the app does it in TS; used by tests): the cert's
/// device ID, the single key, the signature.
pub fn verify(
    sig: &Sig,
    writer_device: &str,
    class_id: &str,
    path: &str,
    canonical: &[u8],
) -> bool {
    let b64 = base64::engine::general_purpose::STANDARD;
    let (Ok(der), Ok(value)) = (b64.decode(&sig.cert), b64.decode(&sig.value)) else {
        return false;
    };
    if ids::device_id_from_cert_der(&der) != writer_device {
        return false;
    }
    let Some(pk) = cert_public_key(&der) else {
        return false;
    };
    let Ok(vk) = ed25519_dalek::VerifyingKey::from_bytes(&pk) else {
        return false;
    };
    let Ok(arr) = <[u8; 64]>::try_from(value.as_slice()) else {
        return false;
    };
    vk.verify_strict(
        &message(class_id, path, canonical),
        &ed25519_dalek::Signature::from_bytes(&arr),
    )
    .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_has_the_domain_prefix() {
        let m = message(
            "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa",
            ".tramado/bans/X.json",
            b"{}",
        );
        assert_eq!(
            m,
            b"tramado-sig-v1\0tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa\0.tramado/bans/X.json\0{}"
                .to_vec()
        );
    }

    #[test]
    fn refuses_bad_inputs_and_missing_identity() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            sign(dir.path(), "x", "a.json", b"{}").unwrap_err().code(),
            Code::Invalid
        );
        assert_eq!(
            sign(
                dir.path(),
                "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa",
                "../a",
                b"{}"
            )
            .unwrap_err()
            .code(),
            Code::Invalid
        );
        assert_eq!(
            sign(
                dir.path(),
                "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa",
                ".tramado/meta/X.json",
                b"{}"
            )
            .unwrap_err()
            .code(),
            Code::SyncUnavailable
        );
    }
}
