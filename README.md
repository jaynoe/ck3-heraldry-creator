# Heraldry Creator

Coats of arms, house names and house words for **Crusader Kings III** with the **A Game of Thrones** mod, from a sentence or two of an idea.

Describe a house, and the app suggests names, words and several coats of arms built only from emblems that exist in your playset. Pick the ones you like, refine them in the editor, and paste the result straight into the game's coat of arms designer.

> Unofficial fan tool. Not affiliated with or endorsed by Paradox Interactive, the A Game of Thrones mod team, George R. R. Martin or HBO.

## Status

Early version, tested on one setup: so far only the **Linux build** has been used for real (on Bazzite), and the only AI tried in real use is **Claude Code**. The API providers, Ollama and the Windows build should work but have not been tried yet; the app marks them as "not tested yet". If something breaks, please [open an issue](../../issues).

## Features

- **Generate:** names, house words and coats of arms from an idea, optionally as a cadet branch of an existing house. Ask for more names, more words or new designs without starting over.
- **Editor:** layers, patterns, the designer's palette, placement with drag and sliders, undo/redo, and "Improve with AI" ("yellow field, the wolf in red, add a crown").
- **Inspiration:** starting ideas for a new campaign (bookmark, house or place, game rules, sigil), grounded in your playset and checked against [A Wiki of Ice and Fire](https://awoiaf.westeros.org).
- **AGOT houses:** search every house of your playset, copy its arms or start a cadet branch.
- **Collection:** your saved arms and run ideas.
- Arms are shown like in game: the shield shape of the house's culture, with its frame.
- Everything you copy uses the exact clipboard format of the in-game designer.

## Requirements

- Crusader Kings III and the A Game of Thrones mod, installed through Steam. The app reads emblems, houses and bookmarks from **your own installation** and the playsets of the Paradox launcher. It ships no game files.
- An AI, one of:
  - **Claude Code** (`claude` CLI) with your Claude subscription; no API key needed.
  - Your own API key for **Anthropic**, **OpenAI**, **OpenRouter** or **Google Gemini**.
  - **Ollama** running locally.
  - **Copy & paste:** the app shows each prompt, you paste it into any chat AI and paste the answer back. Free, but slower.

The AI effort setting (Economy / Normal / Thorough) trades quality for tokens.

## Install

Download the latest build from the [Releases](../../releases) page:

- **Linux:** the `.AppImage` runs on any distribution, including immutable ones (make it executable and start it). `.deb` and `.rpm` packages are there too.
  To get it into your app menu (and to pin it to the taskbar), let [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) integrate the AppImage, or put the file somewhere permanent (e.g. `~/Applications`) and add a menu entry yourself. A taskbar pin made from the running AppImage alone does not work, because it points to a temporary folder.
- **Windows:** `.msi` / `.exe` installers are built automatically but have not been tested much yet. Reports are welcome.

The AppImage and the Windows version update themselves: when a new release is out, the app offers to install it (signed and verified before it is installed). With `.deb` and `.rpm` the app tells you about the new version, and you install the package as usual.

## Privacy

- There is no server behind the app. It talks only to the AI provider you choose, to A Wiki of Ice and Fire for canon checks, and to GitHub to look for a new version at start (you can turn that off in Settings).
- API keys are stored in your system keychain and added by the app's native side; the user interface never sees them.
- Saved arms and ideas stay in a local file (`~/.local/share/ck3-heraldry-creator/library.json` on Linux).

## Build from source

```bash
npm install
npm test               # unit tests (tests that need the game skip without it)
npm run dev            # the UI in the browser at http://localhost:5173, with a small dev API
npx tauri dev          # the desktop app (needs Rust and the Tauri prerequisites for your OS)
npx tauri build        # release bundles in src-tauri/target/release/bundle
```

`CLAUDE.md` describes the architecture in detail: the layered mod file system, the catalog, the software renderer that ports CK3's shaders, and the AI pipeline.

## Credits

- [A Wiki of Ice and Fire](https://awoiaf.westeros.org) for canon (CC BY-SA).
- Fonts: IM FELL English by Igino Marini, IBM Plex by IBM (SIL Open Font License).
- BC7 tables from [bcdec](https://github.com/iOrange/bcdec) by Sergii Kudlai.

See `THIRD_PARTY_NOTICES.md` for details.

## License

[MIT](LICENSE)
