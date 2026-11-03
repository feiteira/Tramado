// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The speech model registry (architecture §5.4, §18.2; audio-pipeline §3): compiled into the
//! app, never read from the network. It is the source of truth for
//! `tools/fetch-speech-assets.mjs` (a unit test compares the two).

use crate::types::{ModelId, ModelTier};

/// whisper.cpp model repository commit: the bytes behind a URL never change.
pub const REV: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";
pub const MODEL_URL_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve";

/// The bundled voice-activity model (Silero v5.1.2).
pub const VAD_FILE: &str = tramado_base::paths::VAD_FILE;
pub const VAD_SIZE: u64 = 885_098;
pub const VAD_SHA256: &str = "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf";
pub const VAD_URL: &str =
    "https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin";

/// The default model (prefs `speech.model`).
pub const DEFAULT_MODEL: ModelId = ModelId::Turbo;

/// The DTW alignment preset whisper.cpp must use for a model (word times are garbage
/// otherwise; `whisper.rs` maps it to `whisper_rs::DtwModelPreset`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DtwPreset {
    Small,
    LargeV3,
    LargeV3Turbo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: ModelId,
    pub file: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub tier: ModelTier,
    pub dtw: DtwPreset,
}

impl ModelSpec {
    /// The pinned download URL.
    pub fn url(&self) -> String {
        format!("{MODEL_URL_BASE}/{REV}/{}", self.file)
    }

    /// The ggml file stem (`transcript.json` `engine.model`, folder spec §8.8).
    pub fn stem(&self) -> &'static str {
        self.file.strip_suffix(".bin").unwrap_or(self.file)
    }
}

pub const MODELS: [ModelSpec; 3] = [
    ModelSpec {
        id: ModelId::Turbo,
        file: "ggml-large-v3-turbo-q5_0.bin",
        size: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        tier: ModelTier::Default,
        dtw: DtwPreset::LargeV3Turbo,
    },
    ModelSpec {
        id: ModelId::Small,
        file: "ggml-small-q5_1.bin",
        size: 190_085_487,
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        tier: ModelTier::Draft,
        dtw: DtwPreset::Small,
    },
    ModelSpec {
        id: ModelId::LargeV3,
        file: "ggml-large-v3-q5_0.bin",
        size: 1_081_140_203,
        sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
        tier: ModelTier::Advanced,
        dtw: DtwPreset::LargeV3,
    },
];

pub fn spec(id: ModelId) -> &'static ModelSpec {
    match id {
        ModelId::Turbo => &MODELS[0],
        ModelId::Small => &MODELS[1],
        ModelId::LargeV3 => &MODELS[2],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_by_id() {
        for m in &MODELS {
            assert_eq!(spec(m.id), m);
            assert!(m.url().ends_with(m.file));
            assert!(m.url().contains(REV));
            assert_eq!(m.sha256.len(), 64);
        }
        assert_eq!(spec(DEFAULT_MODEL).tier, ModelTier::Default);
        assert_eq!(spec(ModelId::Turbo).stem(), "ggml-large-v3-turbo-q5_0");
    }

    /// `tools/fetch-speech-assets.mjs` carries the same table (architecture §18.2).
    #[test]
    fn registry_matches_fetch_script() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tools/fetch-speech-assets.mjs");
        let script = std::fs::read_to_string(p).unwrap();
        for m in &MODELS {
            assert!(script.contains(m.file), "{} missing", m.file);
            assert!(script.contains(m.sha256), "{} hash missing", m.file);
            let size = m.size.to_string();
            assert!(script.contains(&size), "{} size missing", m.file);
            assert!(
                script.contains(&format!("'{}'", m.id.as_str())),
                "{} id missing",
                m.file
            );
        }
        assert!(script.contains(REV));
        assert!(script.contains(VAD_SHA256));
        assert!(script.contains(&VAD_SIZE.to_string()));
        assert!(script.contains(VAD_URL));
    }
}
