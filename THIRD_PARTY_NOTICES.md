# Third-party notices

Heraldry Creator is MIT licensed (see `LICENSE`). It includes or is derived from the following works.

## Fonts (SIL Open Font License 1.1)

Bundled in `src/app/assets/fonts/`, license texts in `public/licenses/` (they ship with every build).

- IM FELL English SC and IM FELL English Italic, by Igino Marini (`public/licenses/OFL-imfell.txt`)
- IBM Plex Sans and IBM Plex Mono, by IBM Corp. (`public/licenses/OFL-ibmplex.txt`)

## bcdec (MIT or Unlicense)

The BC7 partition tables in `src/core/dds/bc7-tables.ts` are generated from bcdec by Sergii Kudlai,
https://github.com/iOrange/bcdec, used under its MIT license:

> Copyright (c) 2022 Sergii Kudlai
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions: The above copyright notice and this
> permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## Libraries

npm and Cargo dependencies (React, Tauri, sql.js, the Anthropic SDK and others) keep their own licenses,
listed in `package-lock.json` and `src-tauri/Cargo.lock`.

## Game data and lore

- The app ships **no** files from Crusader Kings III or the A Game of Thrones mod. It reads them from the
  user's own installation at run time.
- Canon checks quote short introductions from A Wiki of Ice and Fire (https://awoiaf.westeros.org,
  CC BY-SA) to the AI model and link the articles; the app does not store or publish them.
- Crusader Kings III is a trademark of Paradox Interactive. A Song of Ice and Fire belongs to George R. R.
  Martin. This is an unofficial fan tool, not affiliated with or endorsed by Paradox Interactive, the
  A Game of Thrones mod team, George R. R. Martin or HBO.
