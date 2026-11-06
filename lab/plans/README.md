# Plans lab

A separate workspace for one question: after the opening line ends (move 10 to 12), **what is the plan?**
Which side to attack, which pawn break to prepare, where the pieces belong, and what a real opponent usually does.

Nothing in this folder is used by the app, and nothing here changes the app's code. `tools/build_dist.py` only copies
`js`, `lib`, `pieces`, `sounds`, `data` and `book`, so this folder never reaches the live site until we decide to wire a
finished piece in. Scripts for this work live in `tools/plans/` and nothing else imports them.

## Why the opening book cannot be used

The book keeps only positions seen many times, and it is built for the opening trainer. Measured on the 1.06 billion
game build (January 2019 to September 2024): about 42% of games are still in it at move 5, 2% at move 8, 0.4% at move 10
and almost none at move 12. Famous plan-heavy positions are thin or missing. Plan research needs whole games, so it
starts again from the raw monthly Lichess files and keeps full games for chosen openings.

## Where things stand

- Step 1 is built: `tools/plans/extract_games.py`, run in the cloud by the "Plans lab: games for one opening" workflow.
- Step 2 is built: `tools/plans/features.py` turns each game into numbers (castling, pawn moves by wing, a snapshot at
  moves 10, 12, 15, 20, 25, 30).
- Step 3 is built: `tools/plans/plan_stats.py` groups games by structure, labels each side's plan, and compares results
  with what the ratings predict. `out/kid-sample-report.md` is the result on a 2,544-game test sample; the margins are
  wide, so read it as a check that the pipeline works, not as findings.
- Steps 2 and 3 have run on 480,000 King's Indian games: `out/kid-report.md`.
- Step 4 is built: `tools/plans/ml_plans.py` makes a 109-feature table per side at move 12 and tests whether a model
  predicts "pushes pawns against the enemy king over moves 13 to 25" better than castling alone or castling plus recent
  pawn moves. Result: `out/kid-model.md` (AUC 0.71 for the full table, 0.61 for momentum, 0.58 for castling only).
- Step 5 is built and run on a 20,400-game sample: `out/kid-engine.md` (Stockfish depth 12 at moves 12 and 25).
- Step 6 started: the Plans tab in the app (plan cards), a private quiz and engine-line finder in `demo/`, a researched `FEATURES.md`, and condition tests (`kid-conditions`, `kid-targets`, `kid-breaks`, `kid-pieces`).
- `GUIDE.md` pulls the findings together: what works, when, and the warnings.

Run order, for the record:

    python tools/plans/features.py kid-2023-*.jsonl.gz --out features.jsonl.gz
    python tools/plans/plan_stats.py features.jsonl.gz --name kid --out-dir lab/plans/out

## Steps (one at a time)

1. **Games for one opening.** Pull whole games for one opening family (say the King's Indian, ECO E60 to E99) from the raw
   dumps, with rating and time-control filters, keeping the moves to move 40 and the result.
2. **Features.** For each game, work out a small set of numbers at moves 10, 12, 15, 20, 25 and 30: castling sides, pawn
   structure, how far each wing's pawns have advanced, open files, piece placement, material.
3. **Plan statistics.** Group games by structure and count what happens next, and what each plan scores.
4. **Does a model add anything?** Try to predict the plan 15 moves ahead from the position at move 12, against a simple
   baseline (castling sides alone). Test it on lines built to be attacking (Yugoslav Dragon, Mar del Plata, English Attack).
5. **Engine check.** Use the engine's long best lines to confirm or refute what the statistics suggest.
6. **Teaching format.** Plan cards, a quiz, and a play-it-out mode. Only here do we touch the app.
