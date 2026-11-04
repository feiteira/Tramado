<p align="center"><img src="app/public/brand.svg" width="80" height="80" alt=""></p>

<h1 align="center">Tramado</h1>

<p align="center"><b>Your classes, all in one place.</b><br>
Record and transcribe lectures, keep every handout and law text together, share them with your class without a
server, and practise for exams with an AI that shows where each answer comes from.</p>

<p align="center"><a href="https://github.com/feiteira/Tramado/releases"><b>Download</b></a> ·
<a href="docs/manual/en/index.md">Manual</a> ·
<a href="docs/manual/pt/index.md">Manual (Português)</a> ·
<a href="docs/manual/es/index.md">Manual (Español)</a> ·
<a href="PRIVACY.md">Privacy</a> ·
<a href="docs/release-notes/v0.1.0.md">Release notes</a></p>

> **Pre-release 0.1.0-rc.2.** Tested on Linux (Ubuntu 24.04). The Windows and macOS installers are the project's first
> and have not been tried yet: if you try one, please [say how it went](https://github.com/feiteira/Tramado/issues).
> Tramado is new: keep copies of anything you cannot afford to lose.

![Tramado showing a lecture: the player with its waveform and coloured markers, the transcript following the recording with a passage highlighted, and a private note at a timestamp](docs/manual/img/en/lecture.webp)

Tramado is a free, open-source desktop app for university students. Each class is an ordinary folder on your computer
with its lectures, documents, notes and exams. Share a class and your classmates get the same folder, synchronised
directly between your computers. There is no Tramado server and no account to create.

## What it does

### Lectures, recorded and transcribed on your computer

Record a lecture in the room (the microphone) or online (what your computer plays: Zoom, Teams, Meet…), or add a
recording you already have. Tramado asks you to confirm the lecturer's permission first. Transcription runs **on your
computer** with [whisper.cpp](https://github.com/ggml-org/whisper.cpp): the speech model (574 MB recommended, 190 MB
or 1.08 GB as alternatives) downloads once, the first time you need it, and then works offline. In a shared class
exactly one computer transcribes each lecture and everyone gets the transcript; classmates whose computers are plugged
in can volunteer. Follow along as it plays, mark moments with <kbd>1</kbd>–<kbd>4</kbd>, take notes at a timestamp,
correct the transcript together, and export it as Markdown, subtitles or plain text.

### Documents you can search

Drop slides, readings and legislation into a class: PDF, Word, PowerPoint, OpenDocument, RTF, HTML, text, subtitles
and images. Tramado reads their text so that <kbd>Ctrl</kbd>+<kbd>K</kbd> finds a phrase across lectures, documents,
exams and chat at once, and opens the PDF on the right page with the passage marked. Notes are Markdown: class notes
are shared, your own stay on your computer.

### Exams, practised with an AI that cites your sources

Add the date of your next test for a countdown, or add a past exam paper (PDF, Word, a photo, or typed). The AI finds
the questions; you check them; then it drafts answers **from your own class material**, citing the page, the article
of law or the minute of the lecture each claim comes from, with a "grounded" score. Practise question by question, and
the ones you missed come back.

### Class groups, without a server

Invite classmates with one message (a link, a code, a QR code or a file); the link and the QR code open a small web
page that reads the invite in the browser and sends it nowhere. They get the lectures, transcripts, documents, class
notes and a class chat with mentions, replies and an `@AI` that answers from the class's sources. Sharing runs on
[Syncthing](https://syncthing.net), bundled with Tramado: files travel encrypted between your computers (directly, or
through a public Syncthing relay when a network blocks direct connections). Organisers can ask to approve each
newcomer, and everyone can compare **check words** to be sure who they let in. Your own notes, highlights, practice
and Ask conversations stay on your computer.

## Screenshots

<table>
<tr>
<td width="50%" valign="top"><img src="docs/manual/img/en/palette.webp" alt="The search palette: the phrase 'conteúdo essencial' found in two lectures, three documents, an exam and the class chat, with the matching words highlighted"><br><b>Search everything.</b> <kbd>Ctrl</kbd>+<kbd>K</kbd> finds a phrase in lectures, documents, exams and chat.</td>
<td width="50%" valign="top"><img src="docs/manual/img/en/document-pdf.webp" alt="A PDF of a fictional law open on page 9 at article 18.º, with the passage that was searched for marked and the law's articles listed beside it"><br><b>Documents.</b> PDFs open on the right page with the passage marked; laws list their articles.</td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/manual/img/en/exam-answers.webp" alt="A past exam question answered by the AI from the class's own material, with numbered citations to an article of law and a lecture moment, and a grounded score of 100 %"><br><b>Exams.</b> Answers drafted from your class material, each claim with its source.</td>
<td width="50%" valign="top"><img src="docs/manual/img/en/chat.webp" alt="The class chat: an answer by the AI that cites a lecture at 41:12 and an article of law, followed by classmates' messages, one of them a mention"><br><b>Class chat.</b> Replies, mentions, and an <code>@AI</code> that cites the class's sources.</td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/manual/img/en/invite.webp" alt="The invite dialog: Copy invite, a QR code to scan with a phone, the invite code, Copy code and Save as a file"><br><b>Invite.</b> One message, a QR code or a file; the link opens a join page in the browser.</td>
<td width="50%" valign="top"><img src="docs/manual/img/en/members.webp" alt="The Members tab: a newcomer waiting to join, with their check words and the buttons Let in, Not now and Decline, above the class's three members and whether they are online"><br><b>Members.</b> Compare check words, then let newcomers in.</td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/manual/img/en/today.webp" alt="The Today screen: upcoming tests with Practise buttons, a lecture being transcribed on a classmate's laptop, recent lectures and an unread mention in the class chat"><br><b>Today.</b> Tests coming up, transcriptions, recent lectures and unread messages.</td>
<td width="50%" valign="top"><img src="docs/manual/img/en/lecture-dark.webp" alt="The lecture view from the top of this page in the dark theme"><br><b>Dark theme.</b> Light, dark, or whatever your system uses.</td>
</tr>
</table>

The pictures come from the browser demo (`npm run dev:web`): the classes, people and documents in them are fictional.

## Privacy

- **No server, no account, no telemetry, no analytics, no crash reports.** Tramado makes no connection of its own
  until you share a class, turn on AI or download a speech model.
- **What leaves your computer, and when, is listed in full in [PRIVACY.md](PRIVACY.md)**
  ([Português](PRIVACY.pt.md) · [Español](PRIVACY.es.md)). The same table is in the app, in Settings › Privacy. It is
  generated from the code (`app/src/core/privacy/flows.ts`), so the two cannot drift apart.
- The app's window has no network access at all: connections are made only by the app's own process (to OpenRouter,
  Hugging Face and AI services you approved) and by its Syncthing, and your OpenRouter key never reaches the window.
- Settings › Privacy keeps a private list of every AI request made from your computer. It is never sent anywhere.

## AI: free by default, with your own key

AI is optional; everything else works without it. Tramado uses [OpenRouter](https://openrouter.ai) with **your own key**
(free keys work) and asks by default for the free model **`google/gemma-4-31b-it:free`**, falling back to other free
models when it is busy. You choose what providers may do with what you send: *Keep nothing*, *No training*
(recommended, the default) or *Allow free models that may train*, and Tramado never relaxes that choice without asking
you in a window of its own. Cloud transcription through OpenRouter is optional and paid (about 2 cents per lecture);
local transcription is free.

> **OpenRouter is for people aged 18 or over** (its terms of service). If you are younger, skip AI, or connect an
> **OpenAI-compatible service** you run yourself or your school provides instead: a local
> [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai), or a school server (Settings › AI › *Another
> OpenAI-compatible service*). Plain `http` is allowed only for your own computer and your local network.

## Install

Download the installer for your system from the [Releases page](https://github.com/feiteira/Tramado/releases).
**0.1.0-rc.2 is a pre-release, and its installers are not code-signed**, so Windows and macOS ask you to confirm the
first time you open Tramado.

- **Windows 10 and 11**: run `Tramado_<version>_x64-setup.exe`. If SmartScreen says *Windows protected your PC*,
  choose **More info**, then **Run anyway**.
- **macOS 14.2 or later** (Apple silicon and Intel): open the universal `.dmg` and drag Tramado to Applications. The
  app is signed ad hoc but not notarised, so macOS refuses to open it the first time: close the message, then go to
  **System Settings › Privacy & Security**, scroll down to Security and choose **Open Anyway**. After that it opens
  normally.
- **Linux** (x86-64): the `.AppImage` runs on most distributions: make it executable
  (`chmod +x Tramado_<version>_amd64.AppImage`) and open it. If it does not start, install FUSE 2
  (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on older versions). On Debian and Ubuntu you can
  install the `.deb` instead: `sudo apt install ./Tramado_<version>_amd64.deb`.

The installers contain the app, Syncthing and the voice-activity model; the speech model downloads when you first
transcribe. Local transcription needs a 64-bit processor with AVX2 (Intel and AMD since about 2013) or Apple silicon;
without it, classmates' computers or OpenRouter can transcribe for you. The
[release notes](docs/release-notes/v0.1.0.md) list what is new and what is not done yet.

### Build from source

Requirements: Node.js 22.12 or later, Rust 1.90 or later (`rust-toolchain.toml` selects the stable channel), and on
Linux:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev \
  patchelf libasound2-dev libpulse-dev libclang-dev cmake
```

```bash
git clone https://github.com/feiteira/Tramado.git && cd Tramado
npm install
npm run dev:web          # the browser demo, with fictional classes, at http://localhost:1420
npm run dev              # the desktop app (fetches Syncthing and the voice-activity model, both checked by SHA-256)
npm run build:desktop    # AppImage and .deb in target/release/bundle/
```

Contributors: start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) (commands, layout, rules).
Security issues: [SECURITY.md](SECURITY.md).

## Languages

English, European Portuguese and European Spanish: the app, the manual, the privacy page and the release notes.

## Documentation

- The manual: [English](docs/manual/en/index.md) · [Português](docs/manual/pt/index.md) · [Español](docs/manual/es/index.md)
- [Release notes 0.1.0](docs/release-notes/v0.1.0.md)
- For developers: [architecture](docs/dev/architecture.md), the [class folder format](docs/spec/class-folder-v1.md), the
  [sync protocol](docs/spec/sync-protocol-v1.md), the [UX specification](docs/design/ux-mvp.md)

## Credits

Tramado is built on [Trama](https://github.com/feiteira/Trama) (its interface kit, shell, import and search code,
desktop crates and tools) and on the work of many open-source projects, among them
[Syncthing](https://syncthing.net) (sharing), [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and OpenAI's
Whisper models (transcription), [Silero VAD](https://github.com/snakers4/silero-vad) (finding speech),
[libopus](https://opus-codec.org) (recordings), [pdf.js](https://mozilla.github.io/pdf.js/) (PDFs),
[mammoth](https://github.com/mwilliamson/mammoth.js) (Word files), [Tauri](https://tauri.app) and
[React](https://react.dev) (the app), [Lucide](https://lucide.dev) (icons) and the Figtree, Bricolage Grotesque,
Source Serif 4, Atkinson Hyperlegible Next and OpenDyslexic fonts. See [NOTICE](NOTICE) and Settings › About ›
Licences.

## License

[Mozilla Public License 2.0](LICENSE). © Tramado contributors.
