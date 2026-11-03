# AGENTS.md

Guidance for coding agents (and people) working in this repository. `CLAUDE.md` imports this file.

## What Tramado is

A desktop app for students: record and transcribe lectures, keep a class's documents, notes and exams together,
share a class with classmates peer to peer (Syncthing, no server, no account), and practise for exams with an AI
(the student's own OpenRouter key) that cites its sources. Tauri 2 + React 18 + TypeScript + Rust, MPL-2.0,
built on Trama. Status: pre-alpha.

## Commands (architecture §3.4)

```bash
npm install                      # from the repo root (npm workspaces: app, desktop)
npm run dev:web                  # the browser demo (memory platform, fictional classes) at http://localhost:1420
npm run dev                      # desktop app (fetches Syncthing and speech assets first)
npm run dev:lite                 # desktop app without the heavy speech crate
npm run typecheck                # tsc --noEmit (fails on a missing translation key too)
npm test                         # Vitest under Node (app/src/**/*.test.ts); VITEST_MAX_WORKERS=2 when agents share the machine
npm run test:property            # property tests, 2000 runs
npm run build                    # the web build of app/
npm run check:rust               # cargo check --workspace --all-targets (builds whisper.cpp and libopus once)
npm run check:rust:lite          # the same without default features
npm run test:rust                # tramado-base, tramado-net, tramado-sync unit tests
npm run lint:rust:lite           # cargo fmt --check + clippy -D warnings (light crates)
npm run test:contract            # real Syncthing contract tests (Linux)
npm run fetch:syncthing          # the pinned Syncthing binary, checked by SHA-256
npm run check:leaks              # secrets and account ids must never be committed (run before every push)
npm run peek -- --route=<r> --query='…' --ready=<testid> --axe [--lang=pt] [--theme=dark] [--scale=1.25] \
     [--click=<id>] [--press=<key>] [--type=<id>=<text>] [--expect=<id>[:n]] [--expect-not=<id>] \
     [--expect-text=<id>=<s>] [--expect-attr=<id>:<attr>=<v|null>] --out=<png>
node tools/peek-matrix.mjs [--only=m0]   # every entry of tools/peek-routes/*.json; PNGs in tools/peek/out/
npm run screenshots              # manual screenshots (UX §7.4), en/pt/es
```

Heavy Rust builds: `CARGO_BUILD_JOBS=3 CMAKE_BUILD_PARALLEL_LEVEL=3`; run cargo from the repository root.

## Layout

- `app/` — React + Vite + Vitest. `src/core` (pure TS, no DOM), `src/platform` (types, Tauri bindings, memory
  platform), `src/services` (stateful, no DOM), `src/workers`, `src/ui` (kit + Tramado components), `src/shell`
  (app state, router, layout, rail, pills, dock, palette), `src/features` (one folder per screen family, mounted
  through `features/registry.tsx`), `src/demo` (the browser demo).
- `desktop/` — the Tauri app (`src-tauri`). `crates/` — `tramado-base`, `tramado-net`, `tramado-sync`,
  `tramado-speech`.
- `test-vectors/` — JSON vectors shared by Vitest and cargo test. `tools/` — fetch scripts, peek, screenshots,
  leak check, lab sources.
- `docs/dev/architecture.md` (the contract), `docs/dev/plan.md` (work packages), `docs/design/ux-mvp.md` (UX spec),
  `docs/spec/` (folder and sync specs, check words).

## Rules (architecture §19)

1. **Ownership.** Every file has one owner per wave (plan: owned paths per work package). Frozen after M0 and
   changed only by the integrator at a gate: `Cargo.toml`, `desktop/src-tauri/src/{lib.rs,state.rs,util.rs,commands/mod.rs}`,
   all `package.json` files, `app/src/platform/types/index.ts`, `app/src/services/{index,store,context,prefs,identity,hlcClock,classStore}.ts`,
   `app/src/services/types/index.ts`, `core/i18n/locales/*/index.ts`, `features/registry.tsx`, `shell/routes.ts`,
   `demo/{boot,hooks,controls,keys,freeze}.ts`, `services/types/viewModels.ts`, `core/errors.ts`,
   `core/model/{derive,jcs,sig}.ts`, `core/sync/checkWords.ts`, `docs/spec/check-words-v1.txt`, `test-vectors/*`,
   `Cargo.lock`.
2. **Additive contract changes only.** Anything else (renames, removals, new commands, new dependencies) goes under
   "Contract changes requested" in your report; the integrator applies it at the gate.
3. **Registries instead of shared edits**: routes, class tabs, settings sections, dock rows, overlays, palette
   providers and rail badges are pre-registered lazy imports in `app/src/features/registry.tsx`.
4. **Strings**: every user-facing string in EN, PT-PT and ES in the same change, in your own namespaces
   (`app/src/core/i18n/locales/<lang>/<namespace>.ts`). PT-PT: "você" register, Disciplina/Aula/Exame,
   apontamentos, ficheiro. ES: "usted" register, Asignatura/Clase/Examen, apuntes, archivo.
5. **Test ids** (`data-testid`) on every element a test, peek step or e2e touches; identity via `data-*` attributes.
6. **Layers** (checked by `app/src/layers.test.ts`): core → core; platform → core; services → core,
   platform/types, services; workers → core; ui → core and React; shell and features → anything but
   `platform/tauri` and `platform/memory` (only `main.tsx` and `demo/` choose a platform). No DOM in core/services.
7. **Rust**: no `unwrap`/`expect` outside tests and `run()`; named threads; disk and network work in `blocking`.
8. **No StrictMode**; fictional fixtures only; no network in tests (live AI tests only with `TRAMADO_AI_LIVE=1`).
9. **Commits**: `<work-package>: <summary>`, a body that explains why, and the trailer
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tags: `m0`, `wave1`, `wave2`, `v0.1.0-rc.1`.

## Never commit secrets

This repository is public. Never commit an OpenRouter key (or any fragment of one), account ids (`user_id`),
credit or usage figures, e-mail addresses or generation ids. Saved model outputs go through
`node tools/redact-fixtures.mjs` first, and `npm run check:leaks` must pass before every push.
