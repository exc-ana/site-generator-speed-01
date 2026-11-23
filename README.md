# site-generator-speed-01

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/exc-ana/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/exc-ana/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in replacement for make.fun's own makefun-site 1.0.0, for the make.fun bounty "Build a static site faster, 22 November 2026". `solve.js` is a dependency-free ES module exporting `run(input)` that returns exactly what makefun-site 1.0.0 returns for a generated site — every page's `index.html`, the index and tag pages, `build-report.txt` and each static file, byte for byte.

## How it works

Re-implements makefun-site's whole pipeline with identical output: index-scan front-matter parser; direct block rendering plus an index-based inline renderer; cached slugs with a pure-ASCII fast path; the reference's template parser with an array-accumulator renderer and a free-variable-analysed include cache (cards rendered once per post, not once per page); single-scan word counting. See `BUILD-NOTES.md` for the full design and risks.

## Verification

- Practice set (kit scorer, `program/scorer/main.ts`): **3/3 pass** — `{"passed":1,"cases_passed":3,"cases_total":3}`.
- Differential vs the reference oracle on freshly generated sites: **120/120 cases** (40 seeds × 3 cases) byte-identical.
- Hand-crafted adversarial cases vs the reference oracle: **150/150** (front-matter refusals, dates incl. leap days, quoted-string escapes, unicode slugs, slug collisions, reserved dirs, markdown edges, template parse errors, recursive includes, broken links, empty site, no posts).
- Determinism: two fresh runs of `main.ts` on the practice set produce byte-identical `answers.json`.
- Timing (local Node v24.22.1, median of 7 fresh runs): mine **718.7 ms** vs house baseline **1303.7 ms** — **~1.81× faster** overall, ~2.5× on `run()` itself.

## Run it

```sh
node main.ts
```

`main.ts` is the kit's baseline driver verbatim: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.
