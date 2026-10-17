# Plan: CK3 Heraldry Creator (AGOT)

Generate coats of arms, house names and house words for CK3 (A Game of Thrones mod) from a short idea, and export them so they can be pasted into the in-game CoA designer.

## Product decisions

- **Scope:** AGOT (Workshop 2962333032) plus any other installed mods that ship heraldry assets. English only for now.
- **Public release:** the app never ships Paradox, AGOT or other mod assets. It reads them from the user's local install.
- **AI:** no project-owned key and no backend. Providers:
  - **Local CLI** (`claude -p` with the user's own subscription login; Gemini/Codex CLIs possible later), native app only.
  - **Bring-your-own API key** (Anthropic, OpenAI, Gemini, OpenRouter) and **Ollama**.
  - **Copy-prompt mode**, which works without any key.
- **Platform: native desktop app with Tauri.** It auto-detects Steam, the workshop and the launcher DB, stores keys in the OS keychain and can call local CLIs. The UI is web tech, so it can be developed in a browser. A static web build stays possible because `src/core` is platform-agnostic.
- **Playset-aware:** generated CoAs only use assets from mods in the selected launcher playset, honouring load order for file overrides.

## Key facts from the game files

- Asset layout is identical in vanilla and every mod: `gfx/coat_of_arms/{colored_emblems,textured_emblems,patterns}/*.dds`, plus designer metadata `*.txt` in those folders (`file.dds = { colors = N category = X visible = no }`).
- Named colours: `common/named_colors/*.txt` (`name = rgb { r g b }`, also `hsv`/`hsv360`). AGOT uses `agot_*` names.
- CoA definitions: `common/coat_of_arms/coat_of_arms/*.txt`. AGOT splits houses by region (`northern_dynasties.txt`, `dornish_dynasties.txt`, …), about 1,370 entries.
- Colour values in CoAs: named string, `rgb {}`/`hsv {}`, or a reference such as `color1 = color2`.
- Playsets: `~/.local/share/Paradox Interactive/Crusader Kings III/launcher-v2.sqlite` (tables `playsets`, `playsets_mods`, `mods`; `mods.dirPath` points at the mod folder).
- Texture formats found across game and mods: DXT5, DXT1, DXT3, BC7 (DX10 header, DXGI 98), uncompressed 32-bit and 16-bit.
- Rendering (from `jomini/gfx/FX/coat_of_arms/*.fxh`):
  - Pattern: `c = fallback; c = lerp(c, color1, tex.r); c = lerp(c, color2, tex.g); c = lerp(c, color3, tex.b)`
  - Colored emblem: `c = color1; c = lerp(c, color2, tex.g); c = lerp(c, color3, tex.r); c = lerp(c, overlay(tex.b, c), 1.0)`, alpha = `tex.a`
  - Pattern mask (`mask = { … }`): `r' = sat(r-g-b)`, `g' = sat(g-b)`, alpha *= `sat(dot(rgb', maskColor))`
  - Instance transform: position = centre in [0,1] (y down), scale = size (a negative scale mirrors), rotation in degrees.
  - Optional shading: overlay with `coa_mask_texture.dds` blue channel (pattern 0.2, emblems 0.2).

## Status

Done: parser, CoA model and designer clipboard format (verified in game), DDS decoder, layered mod file system, catalog with cache, software renderer with shield frames, the Tauri app (Generate, Editor with Improve with AI, Inspiration with AWOIAF canon checks, AGOT houses, Collection, Settings) and all providers. Only the Linux AppImage with Claude Code has been used for real so far; see the test status in the app and the test reports on GitHub.

## Backlog

- Other local AI CLIs besides Claude Code: wait until someone actually uses one, then build it like the Claude CLI path (fixed arguments, no tools, temp cwd, checks in the Rust host). Research from 2026-10-17 (third-party doc mirrors, so verify with `--help` first; neither CLI was installed here):
  - **OpenAI Codex CLI:** `codex exec` runs non-interactively; `--output-schema <file>` constrains the final answer to a JSON Schema, `--json` prints events as JSON lines, `--ephemeral` skips session files. Image input for `exec` was not confirmed; without it the provider runs with Economy's image settings (no candidate sheets, no visual review). Best candidate.
  - **Gemini CLI:** `gemini -p "…" --output-format json` returns an envelope with a `response` string; no JSON Schema option, so JSON would have to be asked for in the prompt and validated like the copy & paste provider. Google announced that Antigravity CLI replaces it, so wait for that.
  - Until then, the API-key providers (OpenAI, Gemini, OpenRouter) cover users without a Claude plan.
- Cache decoded emblem thumbnails so previews appear instantly.
- Brisure-based cadet variants without AI, tincture-rule checks, a rule-based random generator.
