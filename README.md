# Opening Trainer

A chess opening trainer that plays like real people play. You face a bot that picks its moves from real Lichess games at your rating level, and the game stops the moment you make a real mistake, showing what you could have played, how the engine rates each option, and how real players fared with each.

It is an online app made of plain static files: everything runs in the browser, with no account, no server of your own and no token. The game data ships with the app as many small files, and the browser fetches only the one or two it needs for each position, so a very large database costs nothing extra to open.

## Run it

Needs Python (any 3) only to serve the files. Double-click `start.bat`, then open http://localhost:8765.
Opening `index.html` straight from disk will not work, because browsers block the engine worker and modules on `file://`.

## How it works

- **Opponent:** picks moves in proportion to how often real players choose them (rated 1400-2200, first 15 moves), with a light nudge towards variety and towards your weak spots. The "Opponent" setting runs from exactly real frequencies (1.0) to more variety.
- **Mistakes:** a weighted mix of three signals (how rarely the move is played, how much Stockfish dislikes it, how badly it scores against real players), with leniency in the first three moves and for gambits that score well. Every number is in Settings, and the move log on the Progress tab shows how the rule judged each move so you can tune it.
- **Analysis board:** opens on every mistake, or any time with the Analyse button. Engine lines on top, the games table below, step controls, and look-ahead so clicks are instant.
- **Progress:** a tree of the lines you have met, weak spots to drill, and your history. Export and import your progress from Settings.

## The data

`book/` is built from Lichess's open game database (CC0) by `tools/build_book.py`: rated blitz, rapid and classical games, counted per rating bucket and merged by position. Rebuild or grow it any time:

```
pip install zstandard chess
python tools/build_book.py --url <month1.pgn.zst> --url <month2.pgn.zst> --games-per-url 2500000
```

It streams only the start of each (very large) monthly file and never saves it, in chunks, so it fits in a few hundred MB of memory. `data/openings.json` (opening names and ECO codes) comes from `tools/build_openings.py` and the Lichess chess-openings dataset.

## Growing the book in the cloud (nothing runs on your computer)

The book is limited only by how many games get processed, and that is best done on GitHub's free machines rather than your own:

1. Create a public GitHub repository and push this project to it.
2. Open the repository's Actions tab, choose **Build opening book**, and press **Run workflow**. Each month of Lichess data is built on its own machine, all at once, and the parts are merged.
3. Try it small first (the defaults read 2 million games per month) to see how long a month takes, then raise `games_per_month`. One job may run up to 6 hours.
4. When it finishes, download the **book** artifact, replace the `book/` folder with it, run `python tools/build_dist.py` and upload `dist/`.

Raise `final_min_position` to make a very large book smaller. The app needs no change: it reads the shard count from `book/meta.json`.

## Shipping

```
python tools/build_dist.py
```

writes `dist/`, which holds only the files the app needs, and checks that every file it refers to exists. Upload `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages). See `RELEASE.md` for the checklist and `CREDITS.md` for licences.

## Files

- `js/app.js` screens, game flow, analysis board, progress, settings
- `js/judge.js` the mistake rule
- `js/bot.js` the opponent
- `js/data.js`, `js/book.js` the opening data
- `js/names.js` opening names
- `js/engine.js` Stockfish 19 lite (WASM) in a worker, with a priority queue
- `js/board.js` the board: tap or drag, arrows, animations
- `js/store.js` everything remembered about you (localStorage)
- `tools/` data builders and the dist packager

Practice and preparation only. Do not use during live rated games.
