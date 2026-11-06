# What 480,000 King's Indian games say about plans

Everything here is measured, not remembered. Source: 480,000 whole King's Indian games from Lichess (2023, both players
rated 1400 to 2500, blitz, rapid and classical), of which 392,000 reach move 25, plus Stockfish evaluations on a sample of
20,400. Detail and tables are in `out/`: `kid-report.md`, `kid-model.md`, `kid-engine.md`, `kid-conditions.md`,
`kid-targets.md`, `kid-breaks.md`, `kid-pieces.md`.

How to read the numbers: "+2" means the side scored two points of percentage better than its ratings predict, so it is a
measure of how much a choice helps beyond who is stronger. Margins of about ±0.3 to ±1 are typical. "Engine" is how much
Stockfish's evaluation moved between move 12 and move 25, in pawns.

## The seven findings that held up

1. **Arrival beats availability.** The big effects are in what a side actually does, not what is on the board. A knight
   that reaches an outpost by move 20 is worth +5.2 points; an outpost that just exists is worth 0. A rook that reaches an
   open file by move 20 is worth +1.6; having an open file at move 12 is worth 0.
2. **Pile up on a weak pawn.** An enemy weak pawn is a small edge (+0.8). Adding attackers to it is the plan: sides that
   built up by move 20 scored +2.3, those that did not scored −0.4, and the engine agrees (+0.27 against −0.22 pawns).
   Pressure already at move 12 (more attackers than defenders) is worth +2.5.
3. **A pawn storm wins or loses on the race.** Overall, storming the king scores 1.6 points worse than not storming. It
   pays when you are already ahead in pawn advance on that wing (+2.7, engine +0.37) or well under way (+2.9), and it is
   a mistake when you start late (−3.6) or are behind (−4.2). A locked centre makes it much less bad (−1.0 against −2.9 in
   an open centre).
4. **Their fianchetto bishop turns a storm bad.** With the enemy bishop on g7 or g2 (or b7 / b2) storming costs 2.3
   points, against 0.5 without it.
5. **Do not break just because you can.** Playing a pawn break when one was available scored 1.2 points worse than
   waiting, in positions that were better, equal or worse alike. Exceptions: White's c, d and e breaks are better than
   waiting (+1.7 to +2.0), and earlier is better than later.
6. **Mobility and the bishop pair are real.** More safe squares for your pieces than the opponent's is worth +3.5 from the
   least to the most mobile quarter. The bishop pair against none is worth +2.3.
7. **The centre sets the price of every plan.** In an open centre nearly every wing plan does worse; a locked centre
   is where a plan on the wing costs the least.

## Plan by plan

Each entry: what the plan is, when the data says it works, the warnings, and how strong the evidence is.

### Build up on a weak pawn
- **Needs:** an enemy pawn that is isolated, backward (cannot advance because a pawn controls the square ahead), or the rear
  pawn of a doubled pair.
- **Works when:** your attackers outnumber their defenders on it, and you keep adding pieces to it. A doubled pawn gets won
  more than half of the time (52%).
- **Warnings:** a weak pawn that is well defended (two or more extra defenders) is not a target. Open file or not made no
  difference.
- **Evidence:** strong (784,000 positions; engine agrees).

### Route a knight to an outpost
- **Needs:** a square in the enemy half (your 4th to 6th rank) that one of your pawns guards and no enemy pawn can attack.
- **Works when:** the knight actually gets there, and early (by move 20 the effect is +5.2, engine +0.55).
- **Warnings:** only the arrival counts. Do not count an outpost as an asset until a knight is on it.
- **Evidence:** strong.

### Rook to an open or half-open file
- **Works when:** the rook is placed there once a file opens (by move 20: +1.6).
- **Warnings:** owning an open file without using it is worth nothing.
- **Evidence:** moderate.

### Kingside pawn storm
- **Needs:** you are ahead in the race (more pawn advance on the target wing than they have on yours), your pawns are
  already advanced there, and ideally a locked centre.
- **Warnings:** starting late or behind is the single worst case (−3.6 to −4.2). Opening the centre against a stronger
  centre hurts you. Do not storm against a fianchetto bishop unless the race is clearly yours. Kings on opposite sides make
  a storm cost less (−0.8 against −2.0).
- **Not shown:** counting attackers against defenders at move 12 did not separate good storms from bad, so do not trust that
  rule of thumb on its own. The full textbook recipe (same side, locked centre, enough attackers, not behind) held in
  only 644 positions and scored +5.5, but the margin is ±7.2, so it is a hint.
- **Evidence:** strong for the race and commitment; none for attackers and defenders.

### Pawn break in the centre or on a wing
- **Works when:** it is White's c, d or e break (+1.7 to +2.0 against waiting), and it is early (moves 13 to 14 is the
  best timing; the later the break, the worse).
- **Warnings:** a break played just because it is available lost 1.2 points to waiting. Support (more attackers than
  defenders on the landing square) did not rescue it. For Black, no first break beat waiting in the data, including ...f5
  (−2.8). Black's numbers may partly reflect that the opening is slightly worse for Black on average.
- **Evidence:** moderate; the exceptions are strong.

### Gain space
- **Works when:** it brings piece mobility with it. Space alone is almost nothing once mobility is accounted for
  (+0.07 per standard deviation against +1.36 for mobility).
- **Evidence:** moderate.

### Keep the bishop pair, open the position for it
- **Works when:** you have both bishops and the opponent does not (+2.3).
- **Evidence:** strong in results; the engine does not see an advantage (0.00), so the benefit may be practical, not objective.

### Play on the wing where the king is not
- **Works when:** White plays on the queenside in the closed classical structure (d5 + e4 against d6 + e5): +3.3 against
  expectation. Black playing on the other wing in the same structure does worst (−4.0).
- **Evidence:** moderate, one structure.

## What the data does not tell us

- **Only the King's Indian,** only 2023, only 1400 to 2500. Other openings may differ.
- **Specific sub-lines** (Mar del Plata, Sämisch, Four Pawns) are not separated, because Lichess does not name them cleanly.
- **Cause and effect.** Strong players choose better plans, and the rating adjustment removes most but not all of that. The
  engine check helps, but it comes from a 20,400-game sample and a quick search.
- **Position-specific advice.** All of this is about averages across thousands of positions. It tells you which plan tends
  to work under which conditions, not what to play in your exact position.
- **Things never measured:** king safety after the pawns move, tactics, clocks, and the plans' timing in the endgame.

## How this becomes the trainer

Turn the current Plans tab, which shows frequencies, into a decision aid:
1. Read the position and show the **conditions** that matter (race, weak pawns under pressure, outpost squares, mobility,
   bishops, centre).
2. Show the **menu of plans** that those conditions support, with a "worth doing / not now" mark and the reason, taken from
   the findings above.
3. Show the **engine's own lines** grouped by idea (the finder already does this) so the user can see which good moves serve
   which plan.
4. A **drill**: show a position, ask which plan the conditions point to, and which of the engine's moves serve it.
