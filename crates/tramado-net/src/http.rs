// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The four HTTP agents (architecture §5.2 `http`; critique C35). Every agent reads error
//! bodies instead of failing on a status (`http_status_as_error(false)`): callers tell "no
//! credit" from "no model", 206 from 200, a 403 that means "restart Syncthing", a 404 that means
//! "device not announced".

use std::time::Duration;

fn user_agent(version: &str) -> String {
    format!("Tramado/{version}")
}

/// OpenRouter and custom AI hosts: connect 15 s, response head 120 s, 30 s between reads (SSE
/// keep-alives arrive more often), no overall limit (a long answer may stream for minutes).
pub fn ai_agent(version: &str) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(None)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(120)))
        .timeout_per_read(Some(Duration::from_secs(30)))
        .http_status_as_error(false)
        .user_agent(user_agent(version))
        .build()
        .into()
}

/// Model downloads (Hugging Face, redirects to its CDN followed): connect 15 s, response head
/// 30 s, 30 s between reads.
pub fn download_agent(version: &str) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(None)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_per_read(Some(Duration::from_secs(30)))
        .http_status_as_error(false)
        .user_agent(user_agent(version))
        .build()
        .into()
}

/// The local Syncthing REST API: never through a proxy; per-call timeouts are set by
/// tramado-sync (sync spec §3.2: 70 s for event long-polls, 10 s otherwise).
pub fn loopback_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .timeout_global(None)
        .timeout_connect(Some(Duration::from_secs(5)))
        .http_status_as_error(false)
        .user_agent("Tramado")
        .build()
        .into()
}

/// Syncthing's global discovery lookups (sync spec §11.1): 10 s for the head and between reads.
pub fn lookup_agent(version: &str) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(None)
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_recv_response(Some(Duration::from_secs(10)))
        .timeout_per_read(Some(Duration::from_secs(10)))
        .http_status_as_error(false)
        .user_agent(user_agent(version))
        .build()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{MockResponse, MockServer};

    #[test]
    fn agents_read_error_bodies_and_name_themselves() {
        let m = MockServer::start(vec![
            MockResponse::json(402, r#"{"error":{"message":"no credit"}}"#),
            MockResponse::json(200, r#"{"ok":true}"#),
            MockResponse::json(403, "forbidden"),
            MockResponse::json(404, "{}"),
        ]);
        let mut r = ai_agent("0.1.0").get(m.url("/api/v1/key")).call().unwrap();
        assert_eq!(r.status().as_u16(), 402);
        assert!(r.body_mut().read_to_string().unwrap().contains("no credit"));
        let r = download_agent("0.1.0").get(m.url("/f.bin")).call().unwrap();
        assert_eq!(r.status().as_u16(), 200);
        let r = loopback_agent()
            .get(m.url("/rest/system/ping"))
            .call()
            .unwrap();
        assert_eq!(r.status().as_u16(), 403);
        let r = lookup_agent("0.1.0")
            .get(m.url("/v2/?device=X"))
            .call()
            .unwrap();
        assert_eq!(r.status().as_u16(), 404);
        let seen = m.seen();
        assert_eq!(seen[0].header("user-agent"), Some("Tramado/0.1.0"));
        assert_eq!(seen[0].path, "/api/v1/key");
        assert_eq!(seen[2].header("user-agent"), Some("Tramado"));
        assert_eq!(seen[3].path, "/v2/?device=X");
    }
}
