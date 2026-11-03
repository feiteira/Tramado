# Tramado

Organise your classes: record and transcribe lectures, keep every handout and law text together, share them
with your class without a server, and practise for exams with an AI that shows where each answer comes from.

**Status: pre-alpha.** Nothing here is ready for real classes yet. The scaffold (M0) is in place: contracts,
stubs, the browser demo and the desktop shell. See `docs/dev/plan.md` for the build plan.

- Desktop app: Tauri 2 (Rust) + React 18 + TypeScript.
- Sharing: Syncthing, peer to peer, between classmates' computers. No account, no server.
- Transcription: whisper.cpp on your computer (or, if you choose, a cloud model through your own OpenRouter key).
- Languages: English, Portuguese (Portugal), Spanish.

## Development

```bash
npm install                 # npm workspaces: app, desktop
npm run dev:web             # the browser demo (fictional classes, in memory) at http://localhost:1420
npm run dev                 # the desktop app (Tauri + Vite)
npm run typecheck && npm test && npm run build
npm run check:rust:lite && npm run test:rust
npm run peek -- --route=today --ready=screen-today --axe --out=/tmp/today.png   # one demo screenshot
```

Contributor and agent guidance: `AGENTS.md`. Architecture: `docs/dev/architecture.md`.

## License

[MPL-2.0](LICENSE). Tramado builds on [Trama](https://github.com/feiteira/Trama); see `NOTICE`.
