# Speech fixtures (`tramado-speech`)

Synthetic speech (gTTS, made in the research lab, see `docs/dev/research/openrouter-lab.md`) of
fictional study text, converted to Tramado's `audio.webm` format with the app's own import path:

```bash
cargo run -p tramado-speech --example import_audio -- speech_pt.wav app/test-fixtures/tramado/audio/speech-pt.webm
cargo run -p tramado-speech --example import_audio -- speech_en.wav app/test-fixtures/tramado/audio/speech-en.webm
```

| File | Length | Language | Text (reference for `wer_report`) |
|---|---|---|---|
| `speech-pt.webm` | 16.85 s | pt-PT | Aula 5 de Direito Constitucional. Hoje vamos estudar o artigo 18.º. As restrições aos direitos, liberdades e garantias têm de respeitar o princípio da proporcionalidade e nunca podem afetar o conteúdo essencial do direito. |
| `speech-en.webm` | 9.31 s | en | Hello class. Today we discuss the separation of powers: legislative, executive and judicial branches. |

Both are Opus 24 kbps mono, 16 kHz, 60 ms packets (folder spec §8.7). The reference texts are
the lab's reading of the clips; the TTS source text was not kept.
