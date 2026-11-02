# Release checklist

Not legal advice. A good-faith audit of what is in the project on 2026-11-01.

## Licensing: status

All bundled art, sounds and data are now free to ship (see `CREDITS.md`):

- Pieces: Cburnett (the Lichess look), used under its BSD licence option: keep `pieces/cburnett/LICENSE.txt` with the files
- Sounds: Kenney Impact Sounds, CC0
- Opening book: derived from the Lichess open database, CC0
- chess.js: BSD-2-Clause (keep its licence text)
- Nothing from chess.com is used

**One obligation remains: Stockfish is GPLv3.** The engine is what powers the evaluations, so it is not something to remove. Release the app's source under GPLv3 (or a compatible licence) and keep `lib/sf19/Copying.txt`. That is the only decision left on the licensing side.

## Data

The app has no connection to Lichess at run time: no token, no API calls, nothing to rate-limit. The data is counts from the open database (CC0), stored in `book/`. Don't use Lichess's or Chess.com's names or logos as branding; saying "uses Lichess's open database" is fine.

## Naming

- Pick a name that is not a trademark you would collide with. "Opening Reps" is made of everyday words; check it is free where you publish it.

## Privacy

- Everything is stored in the user's own browser. No accounts, nothing sent to your server.
- The app makes no outside requests while running: no analytics, no API calls, no third-party scripts.
- If you add analytics or a server later, you need a privacy notice.

## Product readiness (not legal)

- [ ] Tune the mistake thresholds on real play (move log, Progress tab)
- [ ] Phone layout (designed for PC so far)
- [ ] Tests for the judge, bot and book code
- [ ] Run `python tools/build_dist.py` after the big book finishes, and upload `dist/` to a static host over HTTPS (GitHub Pages or Netlify work)
- [ ] Add a `LICENSE` file and link the source repository in the app footer
