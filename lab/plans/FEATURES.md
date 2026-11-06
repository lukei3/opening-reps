# Plans lab: the feature list

The point of this list: a plan does not work or fail on its own. A kingside pawn storm works when the centre is locked,
you have more attackers than they have defenders, and their counterplay is slower than yours. So we do not test "does
the storm score well" but **"under which conditions does the storm score well"**.

How each feature gets used: for a plan (say "storm the king"), split the games by the feature and compare the plan's
outcome in each part. Outcomes: result against rating expectation, engine evaluation change from move 12 to 25, and
whether the plan was carried through. A feature matters for a plan if the plan's outcome differs a lot between the parts.

Status: **have** = already in `features.py` or `ml_plans.py`; **easy** = a few lines with python-chess; **medium** = needs a
small algorithm; **hard** = needs the engine or a model.

Where the ideas come from: Silman's imbalances (minor pieces, pawn structure, space, material, key files, holes,
development, initiative), engine evaluation terms (material, imbalance, pawn structure, piece placement, mobility,
threats, passed pawns, space, king safety, initiative), and the usual pawn-storm teaching: lock the centre first, attack
toward the tip of your own pawn chain, win the race against counterplay, and watch for a central break by the defender.

## 1. Centre and pawn structure

| Feature | How to measure | Plans it gates | Status |
|---|---|---|---|
| Centre locked (d and e pawns blocked head to head) | d and e pawns of both sides facing each other with no capture available | king storm, wing expansion | easy |
| Centre open / semi-open | no or one pair of centre pawns left | piece attack, central break | easy |
| Number of central pawn tensions (pawn attacks pawn) | pawn pairs that can capture each other | central break | easy |
| Pawn chain direction | which wing each side's longest chain points to | where to attack (toward the tip) | medium |
| Chain base and tip squares | the pawn at the back and front of each chain | break targets | medium |
| Available pawn breaks per side | legal pawn pushes that create a pawn capture next | break plans | medium |
| Break supported by pieces | attackers minus defenders on the break square | break plans | medium |
| Space (squares behind own pawns, ranks 4 to 6) | count safe squares in own half-plus | all | easy |
| Space difference | own minus enemy space | all | easy |
| Isolated pawns | pawn with no friendly pawn on adjacent files | weak-pawn target | have partly |
| Doubled pawns | two pawns on a file | weak-pawn target | easy |
| Backward pawns | pawn behind neighbours that cannot safely advance | weak-pawn target | medium |
| Passed pawns (and how far advanced) | no enemy pawn ahead on own or adjacent files | passed-pawn plan, endgame | easy |
| Protected passed pawn | passed pawn defended by a pawn | passed-pawn plan | easy |
| Candidate passed pawn | majority on a wing that can create one | majority plan | medium |
| Pawn majority by wing | pawn count by wing, own minus enemy | majority plan | have partly |
| Pawn islands | groups of connected pawns | structure quality | easy |
| Pawn advance by wing | squares advanced per wing | all wing plans | have |
| Pawn lever possible (pawn can attack a pawn in the chain) | legal push next to an enemy pawn | king storm | medium |
| Pawn storm already in progress (how many pawns advanced on the wing) | pawn ranks on f, g, h or a, b, c | king storm | have partly |
| Hanging pawns | adjacent pair on open neighbours | central break, weak pawn | easy |
| Pawn structure type (a named family such as KID closed, Benoni, Maroczy bind, Carlsbad) | classify by centre key and pawn files | which plan menu to show | medium |

## 2. King safety and attack readiness

| Feature | How to measure | Plans it gates | Status |
|---|---|---|---|
| Castling side of each king | castle move | king storm, opposite-wing race | have |
| Kings on the same side or opposite sides | compare | storm versus counterplay | have |
| Enemy king not castled yet / stuck in the centre | castling rights and king file | central break, attack | easy |
| Pawn shield intact (pawns in front of the king) | count | king storm target | have |
| Shield holes (missing f, g, h pawns) | files with no pawn in front | king storm target | easy |
| Attackers: own pieces that can reach the king zone in 2 moves | piece paths to squares around the king | king storm | medium |
| Defenders: enemy pieces guarding the king zone | pieces within reach of the zone | king storm | medium |
| Attackers minus defenders | difference | king storm go/no-go | medium |
| King zone attack units (weighted by piece type) | queen 5, rook 3, minor 2 on zone squares | king attack | have partly |
| Enemy king's escape squares | free squares next to the king | attack | easy |
| Open or half-open files pointing at the king | file state toward the king's file | king attack | have partly |
| Open diagonals pointing at the king | long diagonal with no pawns | bishop and queen attack | easy |
| Queen on the attack side (within reach of the wing) | queen file and distance | king attack | easy |
| Their dark or light squared bishop missing (weak squares around king) | bishop trade, colour of weak squares | king attack | easy |
| Enemy fianchetto bishop present | bishop on g7 or g2 | king attack difficulty | have partly |
| Own king safety (could the counterattack hurt) | same measures for own king | race, risk | have partly |
| Lead in development | pieces developed minus enemy | opening of lines | easy |
| Tempo race (moves needed to reach the break) | count pawn and piece moves to set up the break | storm versus counterplay | medium |
| Counterplay speed (moves needed by the opponent to start theirs) | same for the other wing | storm versus counterplay | medium |

## 3. Pieces

| Feature | How to measure | Plans it gates | Status |
|---|---|---|---|
| Piece counts by type | per side | all | have |
| Piece counts by wing | knights, bishops, rooks, queen on each wing | wing plans | have |
| Bishop pair | two bishops against fewer | open centre, piece play | easy |
| Good versus bad bishop (own pawns on its colour) | pawns on the bishop's colour squares | trades, outposts | easy |
| Knight outposts available (pawn-supported square, cannot be kicked) | square safe from enemy pawns | piece plans | medium |
| Knights on outposts now | knight on such a square | piece plans | medium |
| Rooks on open or half-open files | rook file state | file plans | easy |
| Rook lifts available | rook can move up the board to the wing | king storm | medium |
| Piece mobility (safe squares per piece) | count | all | easy |
| Total mobility difference | own minus enemy | all | easy |
| Trapped or badly placed pieces | pieces with few safe squares | tactic or weakness target | medium |
| Pieces aimed at weak pawns | attackers on an enemy pawn that is weak | weak-pawn plan | medium |
| Piece coordination (pieces defending each other) | number of defended own pieces | all | easy |
| Minor piece trade possibilities | even exchanges available | trades | easy |
| Queen exposure | queen attacked by pieces after a likely push | safety | medium |
| Advanced pieces in enemy half | count | initiative | have |
| Pieces still on the back rank | count | development | easy |

## 4. Targets and weaknesses

| Feature | How to measure | Plans it gates | Status |
|---|---|---|---|
| Weak pawns (isolated, backward, doubled, undefended) | see above | pressure plan | medium |
| Undefended pieces | pieces with no defender | tactics | easy |
| Holes (squares no enemy pawn can ever attack) | per square | outpost plan | medium |
| Weak colour complex (dark or light squares) | holes concentrated on one colour plus bishop missing | complex plan | medium |
| Overextended pawns | pawns advanced without support | break target | medium |
| Pinned or overloaded defenders | pins, defenders with two jobs | tactics | medium |
| Enemy king safety weaknesses | see section 2 | king attack | have partly |
| Open files the enemy cannot contest | file owned by one side | file plan | medium |
| Seventh and second rank access | rook entry squares | file plan | easy |

## 5. Material, trades and endings

| Feature | How to measure | Plans it gates | Status |
|---|---|---|---|
| Material balance | piece values | all | have |
| Material imbalance (two minors against rook and pawn, etc.) | pattern | piece plans | easy |
| Queens on or off | queen counts | king storm (needs queens) | have |
| Rooks on or off | count | file plans | have |
| Phase of the game (total non-pawn material) | scaled value | which plans apply | easy |
| Likely ending type if trades continue (bishop versus knight, same-colour bishops) | piece pattern | trade plan | easy |
| King activity in the endgame | king distance to centre | endgame plans | easy |

## 6. Dynamics and tempo

| Feature | How to measure | Plans it gates | Status |
|---|---|---|---|
| Side to move | turn | all | easy |
| Initiative (threats available per side) | forcing moves: checks, captures, threats | attack | medium |
| Threats against own pieces | attacked and undefended | safety | easy |
| Forcing moves available (checks and captures) | count | tactics | easy |
| Engine evaluation | centipawns | all | hard |
| Engine volatility (spread between best lines) | difference between top moves | sharp or quiet | hard |
| Number of "good" engine moves (within 30cp of best) | multi-line search | how forgiving the position is | hard |
| What the engine's good moves have in common (same wing, same piece, same square) | line descriptors | which plan the engine prefers | hard |
| Time on the clock | clock if known | practical play | easy |
| Rating gap | known | practical play | have |

## 7. Context from real games

| Feature | How to measure | Plans it gates | Status |
|---|---|---|---|
| Opening name and sub-variation | Lichess opening field | plan menu | have |
| Move number when the structure appeared | move counter | speed of plan | easy |
| How common the plan is in this structure | counts from our games | whether it is main line | have |
| Nearest real games (position similarity) | match on structure and pieces | "what worked here" | medium |
| Plan outcome in near neighbours | results and engine drift | recommendation | medium |

## 8. Plan labels we could test

The list of plans to score each position against (so a position gets a menu, not one answer). Several of these need
features above to be recognised.

1. King storm with pawns, same-side castling (needs closed centre).
2. King storm, opposite-side castling (needs the race to be on your side).
3. Piece attack on the king without pawn pushes (needs attackers over defenders).
4. Central pawn break (needs piece support for the break, stable king).
5. Counterplay on the opposite wing to the opponent's attack.
6. Queenside space gain or minority attack.
7. Pressure on a weak pawn (build up until it falls).
8. Outpost plan: knight or bishop to a square that cannot be kicked.
9. File plan: double rooks, take the seventh rank.
10. Trade the bishop pair or the defender of the key square.
11. Simplify into a favourable ending.
12. Create and push a passed pawn.
13. Exchange sacrifice or piece sacrifice to open the king.
14. Prophylaxis: stop the opponent's plan first.
15. Waiting and regrouping (improve the worst piece).

## Suggested order to build

1. Easy features first (about 40). Most are a few lines each in `features.py`.
2. Test the conditions behind plan 1 and 2 (closed centre, attackers minus defenders, race speed), since that was the
   example. Show how the plan's results change across those conditions.
3. Medium features (attackers and defenders count, weak pawns, outposts, breaks).
4. Engine features through the cloud pipeline, which can run on a sample.

## Sources used for this list

- Pawn-storm conditions (closed centre, chain direction, winning the race, defender's central break):
  [The Very Slow King's-side Attack](https://exeterchessclub.org.uk/node/807),
  [Attacking the king](https://www.chess.com/article/view/attacking-the-king),
  [Master Preparation II](https://www.csee.umbc.edu/~sherman/Chess/masterprep/lectures/spring96/less6.html).
- Evaluation terms used by engines: [Evaluation function](https://en.wikipedia.org/wiki/Evaluation_function),
  [Evaluation Overlap](https://www.chessprogramming.org/Evaluation_Overlap).
- Silman's imbalances: [How to Evaluate Chess Positions](https://www.chess.com/article/view/how-to-evaluate-a-position).
- King's Indian plans and the Mar del Plata: [How To Play The Mar del Plata](https://www.chess.com/article/view/an-examination-of-the-mar-del-plata-with-9ne8),
  [Mar Del Plata](https://www.chess.com/article/view/mar-del-plata).

These are general teaching sources, partly blogs and forums, so the list is a set of ideas to test, not settled theory.
