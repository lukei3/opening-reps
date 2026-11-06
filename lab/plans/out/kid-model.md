# Can a model predict the plan? (kid)

Question: with both sides castled by move 12, will the side push pawns against the enemy king over moves 13 to 25? Trained on the first nine months of 2023, tested on October to December.

**All test games**: 160,077 rows, 28% attack. Always guessing the average gives log loss 0.588.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.582 | 0.577 |
| B castling + recent pawn moves | 0.613 | 0.571 |
| C full table | 0.714 | 0.527 |

**White to plan**: 94,087 rows, 28% attack. Always guessing the average gives log loss 0.590.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.592 | 0.572 |
| B castling + recent pawn moves | 0.612 | 0.571 |
| C full table | 0.710 | 0.531 |

**Black to plan**: 65,990 rows, 27% attack. Always guessing the average gives log loss 0.586.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.532 | 0.583 |
| B castling + recent pawn moves | 0.615 | 0.570 |
| C full table | 0.721 | 0.522 |

## Lines built to attack (test months)

**Samisch**: 9,781 rows, 40% attack. Always guessing the average gives log loss 0.711.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.613 | 0.657 |
| B castling + recent pawn moves | 0.631 | 0.655 |
| C full table | 0.721 | 0.598 |

**Four Pawns**: 10,373 rows, 24% attack. Always guessing the average gives log loss 0.552.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.507 | 0.552 |
| B castling + recent pawn moves | 0.532 | 0.551 |
| C full table | 0.696 | 0.504 |

**Averbakh**: 4,646 rows, 36% attack. Always guessing the average gives log loss 0.669.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.592 | 0.641 |
| B castling + recent pawn moves | 0.609 | 0.638 |
| C full table | 0.718 | 0.582 |

**Fianchetto**: 20,572 rows, 22% attack. Always guessing the average gives log loss 0.531.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.520 | 0.524 |
| B castling + recent pawn moves | 0.565 | 0.518 |
| C full table | 0.682 | 0.484 |

**Classical**: 10,198 rows, 23% attack. Always guessing the average gives log loss 0.546.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.564 | 0.539 |
| B castling + recent pawn moves | 0.605 | 0.526 |
| C full table | 0.709 | 0.485 |

## Opposite-side castling only

**Opposite sides**: 40,157 rows, 38% attack. Always guessing the average gives log loss 0.688.

| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |
|---|---|---|
| A castling only | 0.546 | 0.653 |
| B castling + recent pawn moves | 0.590 | 0.651 |
| C full table | 0.706 | 0.598 |

## What the full model leans on

Drop in AUC when that feature is scrambled.

| Feature | AUC lost |
|---|---|
| same_side | 0.0298 |
| own_lead_e | 0.0198 |
| enemy_lead_d | 0.0110 |
| own_adv_K | 0.0096 |
| own_lead_d | 0.0071 |
| own_lead_h | 0.0065 |
| own_lead_f | 0.0058 |
| own_lead_b | 0.0043 |
| own_castle_none | 0.0042 |
| enemy_fian_K | 0.0040 |
| own_pawns_K | 0.0028 |
| enemy_lead_c | 0.0027 |
| own_R_K | 0.0027 |
| enemy_N_Q | 0.0022 |
| own_lead_g | 0.0020 |

## Reading this honestly

- "Plan" here is the pawn-move label from plan_stats.py, a rough rule. Predicting it is not the same as understanding a position.
- A model that beats B only a little means most of the signal is momentum (what each side was already doing).
- Test games come from later months than training games but the same pool of players.
