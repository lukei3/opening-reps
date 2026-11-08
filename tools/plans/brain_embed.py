"""Plans lab: borrow a chess "brain". What Maia-2 and Leela Chess Zero see in each position and move.

Maia-2 (CSSLab, MIT licence) is a neural network trained on millions of human games. Its last hidden layer is a learned
summary of the position; we read it with a forward hook, before and after the move, plus Maia's probability that a human
around 1900 would play the move and its expected score. Those become features for the idea namer, far richer than
hand-made ones.

Leela Chess Zero (GPL, built from source in the cloud) adds its own view when available: its value (win/draw/loss) before and
after the move and its policy probability for the move.

    python tools/plans/brain_embed.py INPUT.jsonl.gz --out brain-0.npz --shard 0 --shards 6 [--leela net.pb.gz]
"""
import argparse
import gzip
import json
import sys
import time

import chess
import numpy as np


def load_maia():
    import torch
    from maia2 import inference, model
    m = model.from_pretrained(type='rapid', device='cpu')
    m.eval()
    prepared = inference.prepare()
    # find the layer just before the output heads: prefer one called last_ln, else the transformer block
    names = [n for n, _ in m.named_modules()]
    print('Maia-2 modules:', [n for n in names if n and '.' not in n], flush=True)
    target = None
    for want in ('last_ln', 'transformer', 'chess_cnn'):
        for n, mod in m.named_modules():
            if n == want or n.endswith('.' + want):
                target = (n, mod)
                break
        if target:
            break
    grab = {}

    def hook(_, __, out):
        t = out[0] if isinstance(out, tuple) else out
        t = t.detach().float()
        if t.dim() == 3:
            t = t.mean(dim=1)
        elif t.dim() == 4:
            t = t.mean(dim=(2, 3))
        grab['v'] = t[0].cpu().numpy()
    target[1].register_forward_hook(hook)
    print('embedding from layer:', target[0], flush=True)

    def run(fen):
        with torch.no_grad():
            probs, score = inference.inference_each(m, prepared, fen, 1900, 1900)
        return grab['v'].copy(), probs, score
    return run


def load_leela(path):
    try:
        from lczero.backends import Backend, GameState, Weights
    except Exception as e:
        print('Leela bindings not available:', e, flush=True)
        return None
    w = Weights(path)
    for name in ('eigen', 'blas', 'onnx-cpu'):
        try:
            b = Backend(weights=w, backend=name)
            print('Leela backend:', name, flush=True)
            break
        except Exception:
            b = None
    if b is None:
        return None

    def run(fen, uci):
        g = GameState(fen=fen)
        out = b.evaluate(g.as_input(b))[0]
        moves = g.moves()
        pol = out.p_softmax(*g.policy_indices())
        p = dict(zip(moves, pol)).get(uci, 0.0)
        g2 = GameState(fen=fen, moves=[uci])
        out2 = b.evaluate(g2.as_input(b))[0]
        return [out.q(), out.d(), p, out2.q(), out2.d()]
    return run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('--out', required=True)
    ap.add_argument('--shard', type=int, default=0)
    ap.add_argument('--shards', type=int, default=1)
    ap.add_argument('--leela', default='')
    ap.add_argument('--minutes', type=float, default=320)
    a = ap.parse_args()
    maia = load_maia()
    leela = load_leela(a.leela) if a.leela else None
    ids, before, after, extra, lz = [], [], [], [], []
    t0 = time.time()
    with gzip.open(a.input, 'rt', encoding='utf-8') as f:
        for i, line in enumerate(f):
            if i % a.shards != a.shard:
                continue
            if time.time() - t0 > a.minutes * 60:
                break
            r = json.loads(line)
            try:
                b = chess.Board(r['fen'])
                mv = chess.Move.from_uci(r['uci'])
                if not b.is_valid() or mv not in b.legal_moves:
                    continue
                e0, probs, s0 = maia(b.fen())
                b2 = b.copy(); b2.push(mv)
                if b2.is_game_over():
                    continue
                e1, _, s1 = maia(b2.fen())
                ids.append(r['id']); before.append(e0.astype(np.float16)); after.append(e1.astype(np.float16))
                extra.append([probs.get(r['uci'], 0.0), s0, s1])
                if leela:
                    try:
                        lz.append(leela(b.fen(), r['uci']))
                    except Exception:
                        lz.append([np.nan] * 5)
            except Exception as e:
                if i < 50:
                    print('skip', r.get('id'), e, flush=True)
                continue
            if len(ids) % 1000 == 0:
                print(f'  {len(ids):,} moves, {time.time() - t0:.0f}s', flush=True)
    np.savez_compressed(a.out, ids=np.array(ids), before=np.array(before), after=np.array(after), extra=np.array(extra, dtype=np.float32),
                        leela=np.array(lz, dtype=np.float32) if lz else np.zeros((0, 5), dtype=np.float32))
    print(f'done: {len(ids):,} moves -> {a.out}')


if __name__ == '__main__':
    sys.exit(main())
