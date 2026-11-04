// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Converts an audio file to Tramado's `audio.webm` with the app's own import path (decode,
//! mix to mono, Opus 24 kbps, WebM). Used for the speech fixtures in
//! `app/test-fixtures/tramado/audio/`.
//!
//!   cargo run -p tramado-speech --example import_audio -- <in.wav|mp3|m4a|…> <out.webm>

use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(input), Some(output)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: import_audio <in> <out.webm>");
        std::process::exit(2);
    };
    match tramado_speech::import::to_webm(&PathBuf::from(input), &|| false, &|_| {}) {
        Ok(im) => {
            if let Err(e) = std::fs::write(output, &im.webm) {
                eprintln!("import_audio: {output}: {e}");
                std::process::exit(1);
            }
            println!(
                "import_audio: {output} ({} bytes, {} ms, from {})",
                im.webm.len(),
                im.duration_ms,
                im.codec
            );
        }
        Err(e) => {
            eprintln!("import_audio: {e} ({})", e.code());
            std::process::exit(1);
        }
    }
}
