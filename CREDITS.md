# Credits and licences

Everything below is free to ship publicly. Nothing from chess.com or Lichess's non-free assets is used.

| What | Source | Licence |
|---|---|---|
| Pieces (`pieces/cburnett`) | Colin M.L. Burnett ("Cburnett"), originals from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Chess_klt45.svg) | Used under the author
| Move, capture, check and finish sounds (`sounds/`) | Kenney, [Impact Sounds](https://kenney.nl/assets/impact-sounds), converted to MP3 | CC0 1.0 (public domain) |
| chess.js (`lib/chess.js`) | Jeff Hlywa | BSD-2-Clause (keep its licence text with the file) |
| Stockfish 19 lite, WASM (`lib/sf19`) | Stockfish developers; WASM build by nmrugg (stockfish.js) | **GPLv3** (see below) |
| Opening names and ECO codes (`data/openings.json`) | [Lichess chess-openings](https://github.com/lichess-org/chess-openings) | CC0 1.0 |
| Opening book (`book/`) | Counts derived from the [Lichess open database](https://database.lichess.org) | CC0 1.0 |
| Board colours, arrows, layout, code | Original to this project | Your choice (GPLv3-compatible; see below) |

## The one real obligation: Stockfish is GPLv3

Stockfish is what makes the evaluations work, so it cannot be removed without losing the analysis and the mistake detection.
If you distribute the app with it, the app's source must be available under a GPL-compatible licence.
The simplest route is to publish the whole project's source under GPLv3 and keep `lib/sf19/Copying.txt` in place.

## Data

The game data (`book/`) is counts derived from Lichess's open game database, and the opening names are from Lichess's chess-openings dataset. Both are CC0. Playing and training never contact Lichess.

## Studies

- The seven built-in studies in `data/studies/` were written for this app from standard opening theory, and checked against the book.
- "Popular on Lichess" (`data/popular-studies.json`) is only a list of titles, authors and links to public Lichess studies. The studies themselves are **not** included in this project: they belong to their authors (Lichess's terms leave user content with the user). When someone presses Import, their own browser fetches that study from Lichess through Lichess's public API, and keeps the copy only in that browser. Studies a person imports from a link or a file are likewise kept only in their own browser.
- The practice positions in `data/conversions.json` were generated for this app and checked with Stockfish.
