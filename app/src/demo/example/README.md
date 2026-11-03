# Demo example content

Everything here is **fictional** (UX spec §7, `docs/design/ux-mvp.md`): people, laws, exams and lectures are
invented, and the browser demo says so in its ribbon.

- M0 ships only the minimal seed (`../seed.ts`): the four classes `law`, `bio`, `stats` and `hist` with their
  names, colours, icons and sharing state, so every route and the rail render.
- T-DEMO (wave 1) adds the example objects here (`types.ts`, `people.ts`, `law.ts`, `bio.ts`, `stats.ts`,
  `hist.ts`, `content/*.ts`, `fill.ts`, `example.test.ts`) and extends the seed to write every file of UX §7.3 as
  spec-conformant class folders, private data and app files.

URL parameters and hooks: UX §7.2 (parsed in `../boot.ts` into `DemoFlags`; keys resolve through `DemoKeys`).
