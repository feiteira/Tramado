<!-- Fictional material only: no real lecture recordings, transcripts, classmates' names, chat messages or API keys in
code, fixtures, screenshots or this description. -->

**What changes and why**

**How it was checked**

**Checks**
- [ ] `npm run check:leaks`, `npm run typecheck` and `npm test` pass (and `npm run lint:rust:lite` / `npm run test:rust` for Rust changes)
- [ ] Visible text added or changed in all three languages (en, pt-PT, es-ES), in the namespace's own files
- [ ] Manual updated in all three languages (`docs/manual/{en,pt,es}`) if how something is done changed; `node .github/scripts/check-links.mjs` passes
- [ ] `data-testid` on what tests and peek touch; works from the keyboard, in light and dark themes, at 1000 × 660 and 125 %
- [ ] No new network access; any new way data leaves the computer is in `app/src/core/privacy/flows.ts` and `PRIVACY.md` is regenerated
- [ ] Files on disk and on the wire follow `docs/spec/` (or the spec change is part of this pull request)
- [ ] Commits are signed off (`git commit -s`)
