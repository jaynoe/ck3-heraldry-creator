# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A tool that generates Crusader Kings III coats of arms, house names and house words from a short idea, for the **A Game of Thrones (AGOT)** mod. Roadmap and verified game-format facts are in `PLAN.md`. UI and content are English; the maintainer discusses in German.

Hard constraints:
- **Never commit or bundle game/mod assets** (DDS, script files). The app reads them from the user's own install. Tests that need them must skip when the files are missing.
- **No project-owned AI key and no backend.** Users bring their own API key, or use their local CLI login (`claude -p`, which runs on their subscription). The target is a native **Tauri** app with a web-tech UI.
- Each `claude -p` run costs the user's subscription quota. Only run `generate` when it is actually needed.
- `src/core` must stay **platform-agnostic** (no `node:` imports). All file access goes through `FileSource`. Node-only code lives in `src/node`, and later browser/Tauri adapters sit next to it.

## Commands

Node comes from Homebrew (`/home/linuxbrew/.linuxbrew/bin`), and runtime TS is run with `tsx`.

Rust/Tauri live in the **distrobox `heraldry-dev`** (Fedora 44 with WebKitGTK devel libs, Node 22, and rustup in the shared `~/.cargo`). The host is Bazzite (immutable), so do not install system packages on the host.

```bash
npm run app                                # native Tauri app (dev mode, hot reload) inside the distrobox
npm run app:build                          # release build: AppImage (~110 MB, bundles WebKit), .deb, .rpm in src-tauri/target/release/bundle
npm run dev                                # UI at http://localhost:5173 (Vite + dev API)
npm run build                              # production build of the UI
npm test                                   # vitest run (all tests)
npx vitest run test/coa.test.ts            # single file
npx vitest run -t "round-trips"            # single test by name
npm run typecheck                          # tsc --noEmit (TypeScript 7)

npm run cli -- playsets                    # launcher playsets (* = active)
npm run cli -- scan --playset "My AGOT playset"
npm run cli -- house stark --playset "My AGOT playset"
npm run cli -- render dynn_Stark --out stark.png [--size 256] [--shading]
npm run cli -- export house_Cassel         # CoA as script text
npm run cli -- generate "<idea>" [--parent dynn_Tully] [--variants 3] [--out-dir out] [--no-vision]
npm run cli -- refine file.txt "<instruction>" [--out-dir out]   # before/after PNG + script
npm run render-file -- file.txt            # render pasted CoA script(s) to PNG
npm run eval-designs -- [--gold "Name,Name"] [--mode normal] [--only 3] [--no-generate] [--out out/eval-x]   # fixed ideas → HTML report (costs CLI quota)
npm run eval-rate -- out/eval-a out/eval-b [--out out/rate.html]   # blind 1–5 star rating page for two or more runs
```

Without `--playset`, the CLI uses the launcher's active playset. Paths can be overridden with `STEAM_ROOT`, `CK3_GAME_DIR` and `CK3_USER_DIR` (`src/node/paths.ts`).

## Architecture

Data flow: **launcher DB → playset → layered FS → catalog → render/export**.

- `core/mods/playsets.ts` reads `launcher-v2.sqlite` via injected sql.js and returns the enabled mods in load order.
- `core/fs/layered.ts`: `LayeredFs` stacks vanilla and then the mods. A later layer overrides files by path, and a mod's `replace_path` (from its descriptor, `core/mods/descriptor.ts`) hides earlier layers in that folder. This mirrors CK3, and everything in the catalog must go through it.
- `core/catalog/catalog.ts` builds the catalog:
  - assets (colored/textured emblems, patterns) plus designer metadata (`colors`, `category`, `visible`) from the `.txt` files in each asset folder
  - named colours and the designer palette
  - CoA definitions
  - dynasties with localised name, culture, words (`motto` keys) and a `group` taken from the file name (AGOT splits by region)
  - houses from `common/dynasty_houses` (e.g. `house_Karstark` under `dynn_Stark`) in the same map, with `dynasty` set and region/culture from the parent; names without localisation fall back to the bare key (`dynn_Karstark` → "Karstark")
  - bookmarks (`common/bookmarks`, AGOT dates are 8000 + AC, see `bookmarkYear`) and game rules from mods (rule files that vanilla also has count as vanilla)

  Textures decode lazily through `TextureCache`.
- `core/pdx/parser.ts` is a generic Paradox script parser. It keeps duplicate keys in order, which CoAs need for repeated `instance`/`colored_emblem`. It resolves `@var` declared at any depth and `@[ ]` math, and tags `rgb {}`/`hsv {}` blocks. All 228 CoA-related files in the game and the installed mods parse with it.
- `core/coa/` holds the CoA model, parsing (`coaFromBlock`, `parseCoaFile`), colour resolution (named → rgb, `colorN` references) and `serializeCoa`. Parse and serialise round-trip losslessly.
- `core/dds/dds.ts` decodes DXT1/3/5, BC7 and uncompressed masked DDS. The BC7 tables in `bc7-tables.ts` are generated from bcdec (MIT); do not hand-edit them. Output is pixel-identical to Pillow.
- `core/render/render.ts` is a software renderer that ports CK3's shaders (`jomini/gfx/FX/coat_of_arms/*.fxh`):
  - Pattern: `lerp` fallback → color1/2/3 by the texture's R/G/B channels.
  - Colored emblem: color1 → color2 by **G**, → color3 by **R**, then an overlay with **B** (128 is neutral); alpha comes from A.
  - A higher `depth` is drawn further back.
  - It works on plain RGBA buffers, so the same code runs in Node and the browser.
- `core/ai/` holds the generation pipeline. `generate.ts` runs these steps:
  1. **concept**: names, words, region and design directions, with motifs given as search keywords.
  2. `search.ts`: keyword search over emblem file-name tokens, synonyms and the names of the houses using each emblem (many AGOT emblems are named after houses, e.g. `ce_greyjoy`).
  3. **compose** into a `DesignSpec` (`spec.ts`): layers back to front, each with a named layout from `layouts.ts` or explicit placements.
  4. `validateSpec` against the catalog plus geometry checks (`ai/checks.ts`: seams, and `findOverlaps` for charges that overlap, touch or cross a chief/canton/bordure or a small pattern part, or run off the shield), with one repair round.
  5. With vision: a numbered contact sheet of the candidates (`render/sheet.ts`) before compose, then a review of the rendered drafts.

  Providers implement `LlmProvider` (`ai/provider.ts`). The bring-your-own-key adapters live in `core/ai/providers/`:
  - **Anthropic:** official SDK with `output_config.format` json_schema and server-side `fallbacks: "default"`.
  - **OpenAI-compatible:** OpenAI, OpenRouter and Ollama, using JSON mode plus the schema in the prompt.
  - **Gemini:** `responseMimeType` JSON.
  - **Manual:** a copy and paste dialog with no images, so the review step is skipped.

  **Keys never reach the page.** Adapters call `HostFetch`, and the host (Tauri `host_fetch`, or dev `/api/http`) only allows the provider's own API URL and adds the key itself. In Tauri the key comes from the OS keychain (`keyring` crate, e.g. KWallet on KDE). In dev it comes from `~/.config/ck3-heraldry-creator/dev-keys.json` (mode 0600). `relaxSchema` strips `minItems` etc., which our validation checks anyway. The provider choice is kept in localStorage (`src/app/providers.ts`).

  `src/node/providers/claude-cli.ts` spawns `claude -p` with `--json-schema`. Images need `--input-format stream-json`, which also requires stream-json output, and the CLI runs from a temp cwd so it does not load this CLAUDE.md.
- **AI effort** (`core/ai/mode.ts`): Economy / Normal / Thorough. Each level sets the model's effort (`JsonRequest.effort`: Claude CLI `--effort`, Anthropic `output_config.effort`, OpenAI `reasoning_effort`, OpenRouter `reasoning.effort`; Gemini and Ollama ignore it), whether images are used (Economy has no candidate sheets and no visual review, which saves the most tokens) and the number of repair rounds. `withRequestOptions` adds effort and model to every request, and values already set on a request win, so "More names/words" always run at `low`. The adapters retry once without effort when a model rejects it. The Claude CLI model comes from Settings as `JsonRequest.model`; both hosts (Node provider and Rust `claude_json`) accept only `isSafeModelName` values and the three efforts, so page input can never become a CLI flag.
- **Inspiration** (`core/ai/inspire.ts`, tab "Inspiration"): a few starting ideas for a new campaign in one text-only call, no conversation. The prompt is grounded in the playset: bookmarks with featured characters (free yearly starts only as a range), regions with sample houses, and AGOT's own game rules (other mods' rules are left out, capped at 8k characters; one playset had 100k of them). Every idea is checked afterwards: unknown bookmarks, houses and rule options are dropped or flagged in `notes`. "Create this house" hands the idea (and the parent for a cadet branch) to Generate.
- **Canon from AWOIAF** (`core/ai/canon.ts`): A Wiki of Ice and Fire is the primary source for lore. The model names 2–4 article titles per idea; `awoiafSource` fetches their introductions in one batched MediaWiki query (plus the singular form, plus a search for titles that do not exist), and with Normal/Thorough a "canon check" call corrects the canon text against the excerpts (Economy only links the articles). Requests go through the host (`Platform.wikiQuery`: dev `/api/awoiaf`, Tauri `awoiaf_query`) with an identifying User-Agent, because the site's crawler guard blocks headless and anonymous clients and rejects CORS preflights. Hosts forward only `action=query` and the `WIKI_PARAMS`. Source links open via `Platform.openUrl` (Tauri opener plugin, capability limited to `https://awoiaf.westeros.org/*`).
- Follow-ups on a result (`generate.ts`): `moreNames`, `moreWords` and `newDesigns` (new directions for the chosen name and words, with an optional wish from the user) redo one part without a full run.
- `core/ai/refine.ts` runs "Improve with AI" on an existing CoA:
  1. **plan**: from the spec and a render, which new emblems are needed, as search keywords.
  2. **compose**: the revised `DesignSpec`, choosing from the current emblems plus search hits, with the candidate sheet.
  3. `checkDesign` plus one repair round.

  Examples for compose come from `ai/examples.ts`: `exampleArms` picks real AGOT arms that share the directions' motifs and show clean craft (2–3 elements, no wavy fields); `mentionedHouses` finds capitalised house names in the idea, whose arms go into the prompts so a marriage or descent can combine them. The design rules favour clean, balanced arms (one main charge, at most one or two supporting elements, each in its own space, harmonious colours, wavy fields only when water is central); the "more creative" version with more elements rated worse in a blind test.

  **Design quality loop:** change prompts or checks, run `npm run eval-designs` for the old and the new version (a git worktree for the old one), then `npm run eval-rate` and let the maintainer rate blind. Release only what rates better. Reports embed their images (sandboxed browsers can only read the file they open) and live in `out/` (gitignored: renders of game assets).

  Shared prompt parts (`SYSTEM`, `designRules`, contact sheets, `checkDesign`) live in `ai/design-rules.ts`. Spec colours may be palette names or `#rrggbb` (custom colours from imported designs). `coaToSpec` resolves `colorN` references. Textured emblems and subs are carried over unchanged.
- **Shield shapes** (`core/render/frame.ts`): like in game, arms are cut out with the mask of the culture's house frame (`house_coa_frame` in `common/culture/cultures`, mask `gfx/interface/coat_of_arms/frames/<frame>_mask.dds`, shape in the alpha channel; AGOT has andal, valyrian, oval and round shapes). `frameFor` picks the house's own culture, then the parent of a cadet branch, then the most common frame in the region. On top goes the frame art (`frames/<frame>.dds`, a strip of 6 tiers that follow dynasty splendour in game; the app always uses `FRAME_TIER` = gold). `CoaPreview` takes `shape` (`null` keeps the square, used for emblem and pattern tiles) and `outside` (the editor keeps cut-off parts at 25 % and leaves the frame off, so placement near the edge stays visible). Without frame art a thin CSS outline follows the shape. This replaces the design file's "no shield crop" note, on the maintainer's wish.
- `core/session.ts`: `HeraldrySession` wires up the FS, the catalog and the render context (mip chains, optional cloth shading from `coa_mask_texture.dds`).

### UI (`src/app`, React + Vite)

**Rule from the maintainer:** every action must show visible feedback (busy, done, error). Use `components/ActionButton.tsx` for anything that saves, copies, deletes or loads, and never add a silent button. When an ActionButton swaps places with another one (e.g. "Copy" → "Really delete"), give them `key`s, or React reuses the old button's state.

**Look:** the visual spec is `design/app-layout.figcraft` (gitignored, it embeds CoA renders; inspect with `figcraft-cli info|export --page Views`). `design/docs/design-handoff.md` lists the tokens, measurements and decisions (both local only; `styles.css` is the source of truth in the repo). In short: "Woodcut", **dark only** (no `prefers-color-scheme`), Or accent `--accent`, pastel red `--error` for errors and danger only, radius 0, 2 px control borders.
- All tokens and component styles are in `styles.css`. Buttons are outlined by default; kinds are the classes `primary`, `ghost`, `danger` (outlined), `confirm` (solid, "Really delete") and the size `small`. `link` is an inline text link, `chip` the #1/#2 toggles.
- `components/Icon.tsx`: `Icon` inlines `src/app/assets/icons/*.svg` (copied from `design/icons/`, one path in `currentColor`), plus `Spinner` and `ErrorLine`. `components/Section.tsx` is the collapsible panel used in the editor and the Collection.
- Fonts (OFL, bundled): IM FELL English SC for titles and names (`.title`, `.heading`, `.name`), IM FELL English Italic for house words (`.words`), IBM Plex Sans for the UI, IBM Plex Mono for file names and scripts. Files in `src/app/assets/fonts/`, license texts in `public/licenses/` (they ship with the build). Uppercase is done with `text-transform`, so keep source strings in normal case.
- Logo: `src/app/assets/quartered-small-dark.svg` (header, favicon); `quartered-colour-dark.svg` is the large mark.
- Layout: header 56 px, notices under the double rule, `main` is the only scroll container, status bar 30 px. Below 1100 px the brand text and playset label hide and "AGOT houses" reads "Houses".
- Headless screenshots for comparing against the frames: Playwright's Chromium in `~/.cache/ms-playwright` with `playwright-core@1.56` installed outside the repo; the "Copy & paste" provider drives Generate and Improve with AI without any AI cost. Note that the dev server uses the real library file, so remove test entries afterwards.

**Security model** (the page is treated as untrusted; the host decides):
- Tauri CSP in `tauri.conf.json` (`devCsp` is off for Vite's HMR): own files only, `wasm-unsafe-eval` for sql.js, `blob:`/`data:` images for renders, `ipc:` for commands. Model output is only ever rendered as text.
- `host_fetch` only reaches each provider's API prefix and never follows redirects (they would carry the key header to another host); `awoiaf_query` forwards only `WIKI_PARAMS`; the opener only allows AWOIAF, the new-issue form and the release pages; updates install only with a valid signature; `fs_*` check canonical paths against the game, workshop and Paradox user folders.
- `claude_json` builds all arguments itself, disables tools, kills the CLI after 5 minutes and hides the console window on Windows.
- The dev API refuses cross-site requests (`Sec-Fetch-Site`/`Origin`), since it can run the CLI and use the stored keys.
- Library and cache are written atomically (temp file + rename); a library that fails to load is an error, never an empty list, so a save cannot wipe it. `jsonLibrary` runs changes one after the other.
- `withShapeCheck` checks every answer against its request schema, because JSON-mode providers and pasted answers are not bound to it.

The UI only talks to its host through `Platform` (`src/app/platform/types.ts`): playsets, file sources, AI provider and library store. Everything else runs in the page, including catalog building, rendering and generation.

- **Browser dev:** `platform/dev.ts` plus the Vite plugin `dev/api-plugin.ts`. The plugin exposes `/api/fs/*` (read-only, limited to the game, workshop and Paradox user folders after `realpath`), `/api/llm` (runs `ClaudeCliProvider`) and `/api/library`. Loading a playset takes about 2 s, roughly 2.8k HTTP requests.
- **Tauri:** `platform/tauri.ts` calls the Rust commands in `src-tauri/src/lib.rs`, which mirror the dev API:
  - `fs_list` and `fs_read` use canonicalised root checks.
  - `claude_json` builds the `claude -p` arguments itself (tools disabled) and looks for the binary in `~/.local/bin` when PATH is minimal.
  - `library_*` use the same `~/.local/share/ck3-heraldry-creator/library.json` as dev.
  - `detect_paths` reads Steam `libraryfolders.vdf`.

  The release AppImage was verified on the Bazzite host outside the distrobox (2026-10-16): cache, claude CLI, keychain (KWallet) and library all work. The AppImage is the right artifact for immutable distros.

  `main.tsx` picks the platform via `isTauri()`. In `tauri dev`, frontend edits hot-reload, and only Rust changes recompile.
- **Editor** (`components/editor/`): the editor keeps the CoA in "editable form" (`core/coa/edit.ts`).
  - The order of `coloredEmblems` is the drawing order (back to front). `toEditable` folds game `depth` values and `parent` inheritance into it, and `withDepths` recreates the depths on export.
  - It has undo/redo (slider drags within 400 ms merge into one step) and drag-to-move on the preview.
  - Textured emblems and sub-CoAs are kept but cannot be edited.
  - `CoaPreview` renders through one global queue and re-renders only when the content changes (JSON key).
- **Catalog cache:** `core/catalog/cache.ts` stores each playset's built catalog in `~/.cache/ck3-heraldry-creator/catalog-<playset>.json` (about 2 MB, 15 ms to restore).
  - The fingerprint covers the game version (`launcher/launcher-settings.json`) and the mod ids, versions and `timeUpdated` from the launcher DB.
  - The game files are **never re-read automatically**, which is what the maintainer asked for: a stale cache only shows a notice, and the "Re-read game files" button triggers the scan. Bump `CACHE_FORMAT` when catalog building changes.
- **Test status:** `ProviderInfo.tested` (`tested` / `light` / `untested`, only Claude Code is `tested`) shows as `TestTag` in Settings, next to the active AI and in the status bar. On Windows a dismissible notice says the build is untested. Keep this in step with the onepager's test notice.
- **Onepager:** a separate project in `../ck3-heraldry-onepager`, independent of this repo and published on its own; nothing of it belongs here. It reads the latest GitHub release of this repo at run time, so publishing a release updates its downloads.
- **Test reports:** `.github/ISSUE_TEMPLATE/test-report.yml` is a GitHub issue form (build, version, system, AI provider, and separate results for the app and the AI). Reports get the label `test-report`; adding `verified` after checking one makes the onepager show it in its builds and AI provider tables. One working report marks a build or provider as tested for good; later problems are normal issues. "Report a test" links in the app (`ReportTestLink`, `report.ts`) prefill version, build (`build_kind` in Rust) and provider; the opener capability allows only that new-issue URL besides AWOIAF. The Build options must match `BUILDS[…].form` in the onepager's `js/main.js`, and the AI provider options the provider labels here.
- **Releases:** push a tag `v*` (bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` first); `.github/workflows/release.yml` builds Linux and Windows bundles into a draft release, which you publish on GitHub.
- **Updates** (`components/Updates.tsx`, `Platform.checkUpdate`): Tauri's updater plugin reads `latest.json` from the latest published release (endpoint and public key in `tauri.conf.json`). The release workflow signs the bundles with the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the key lives outside the repo in `~/.tauri/heraldry-creator.key` (+ `.password`), and `npm run app:build` uses it when present (otherwise `--no-sign`). Losing the key means installed apps can never update again. Only the AppImage and Windows install updates themselves (`build_kind`); `.deb`/`.rpm` get a notice with the release page. The check runs at start unless turned off in Settings (`heraldry.updateCheck`); a failed start-up check stays silent, "Check now" reports errors.
- **Collection** (tab, `CollectionView.tsx`; was "My arms"): one JSON list of `LibraryItem`s (`core/library.ts`) in `~/.local/share/ck3-heraldry-creator/library.json`, shared by dev and Tauri (both hosts store it opaquely). Arms are `SavedCoa` (no `kind` or `kind: 'arms'`, the designer clipboard script is the source of truth); run ideas are `SavedIdea` (`kind: 'idea'`) holding an `IdeaSnapshot`, which keeps names and years as text so a saved idea stays readable with any playset. `IdeaCard.tsx` shows an idea in Inspiration and in the Collection's popup.

## Open assumptions (verify in game before relying on them)

- `parent` inheritance: the child overrides pattern and colours and its emblems are appended.
- Missing *CoA* (pattern) colours fall back to grey. Missing emblem `color1` uses red like color2/3, but only color2/3 were tested.

Verified in game (fixtures in `test/fixtures/`):
- `rotation` is in degrees, positive = clockwise.
- A higher `depth` is drawn further back.
- Missing emblem colours become the named colour `red`, **not** the CoA's colours (`emblem-default-colors.txt`).

Verified: the designer's clipboard format is `key={`, 4-space indent, unquoted colour names and 6-decimal numbers (`test/fixtures/designer-random.txt`, a real in-game copy). `serializeCoa` reproduces it byte for byte, and a test guards this.
