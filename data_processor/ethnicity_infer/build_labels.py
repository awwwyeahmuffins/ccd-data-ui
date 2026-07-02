#!/usr/bin/env python3
"""build_labels.py — Stage 1: manufacture a labeled training set from the
(unlabeled) voter file via distant supervision.

We have no ethnicity labels, so we create them:
  * POSITIVE  (target, e.g. 'nepalese') = voters whose surname is in the
    distinctive-Nepali seed list. High precision by construction.
  * HARD NEG  ('indian')                = names from an external Indian-surname
    list. Teaches the Nepali/Indian boundary — the whole point.
  * EASY NEG  ('other')                 = a random sample of everyone else,
    reservoir-sampled so we don't hold 750k names in RAM.

Output: training_data.csv  (columns: text, last, label, source)

Usage:
    python3 build_labels.py                 # uses config.json defaults
    python3 build_labels.py --voter-file /path/to/file.txt
"""
import argparse
import csv
import json
import os
import random

import pandas as pd

import names_common as nc

HERE = nc.HERE


def load_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve(p):
    """Absolute as-is; else prefer a path next to the scripts (seeds/), then
    fall back to repo root (voter file)."""
    if os.path.isabs(p):
        return p
    here = os.path.join(HERE, p)
    return here if os.path.exists(here) else os.path.join(nc.ROOT, p)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--voter-file", default=None, help="override config voter_file")
    ap.add_argument("--out", default=os.path.join(HERE, "training_data.csv"))
    ap.add_argument("--chunksize", type=int, default=100_000)
    args = ap.parse_args()

    cfg = load_config(args.config)
    target = cfg["target"]
    eth = cfg["ethnicities"][target]
    cols = cfg["columns"]
    rng = random.Random(cfg.get("random_seed", 42))
    ratio = cfg.get("easy_negative_ratio", 4)

    voter_file = resolve(args.voter_file or cfg["voter_file"])
    seed_pos = nc.load_seed_set(resolve(eth["seed_surnames"]))

    # Hard negatives: one or many classes. Accept the legacy single-file string
    # or the multi-class list-of-{file,label}. Order = match priority.
    hn_spec = eth["hard_negatives"]
    if isinstance(hn_spec, str):
        hn_spec = [{"file": hn_spec,
                    "label": eth.get("hard_negative_label", "hard_negative")}]
    hard_classes = []          # [(label, surname_set), ...] in priority order
    combined_hard = {}         # surname -> label (first class wins)
    for h in hn_spec:
        s = nc.load_seed_set(resolve(h["file"]))
        hard_classes.append((h["label"], s))
        for sn in s:
            if sn not in seed_pos:
                combined_hard.setdefault(sn, h["label"])

    if not seed_pos:
        raise SystemExit(f"FATAL: positive seed list is empty: {eth['seed_surnames']}")
    if not combined_hard:
        print("WARNING: all hard-negative lists empty/missing. The model will "
              f"struggle to separate {target} from similar origins.")

    def hard_label_for(last):
        for label, s in hard_classes:
            if nc.dict_hit(last, s):
                return label
        return None

    print(f"Scanning {voter_file}")
    print(f"  positive seed: {len(seed_pos)} | hard-neg classes: "
          + ", ".join(f"{lbl}={len(s)}" for lbl, s in hard_classes))

    pos = {}                 # text -> last  (dedup on full name text)
    hard_from_voters = {}    # text -> (last, label) for voters in a hard class
    easy = []                # reservoir of (text, last)
    seen_easy = 0

    usecols = [cols["last"], cols["first"]]
    reader = pd.read_csv(voter_file, usecols=usecols, dtype=str,
                         chunksize=args.chunksize, keep_default_na=False)

    # Reservoir cap: generous; trimmed to ratio*len(pos) at the end.
    RES_CAP = 200_000
    for chunk in reader:
        for last, first in zip(chunk[cols["last"]], chunk[cols["first"]]):
            text = nc.name_text(first, last)
            if not text:
                continue
            if nc.dict_hit(last, seed_pos):
                pos[text] = nc.norm(last)
                continue
            label = hard_label_for(last)
            if label:
                hard_from_voters[text] = (nc.norm(last), label)
                continue
            # reservoir sample easy negatives
            seen_easy += 1
            if len(easy) < RES_CAP:
                easy.append((text, nc.norm(last)))
            else:
                j = rng.randint(0, seen_easy - 1)
                if j < RES_CAP:
                    easy[j] = (text, nc.norm(last))

    n_pos = len(pos)

    # Hard-negative examples: one bare-surname example per seed surname, plus the
    # real first+last voters in each class. Keyed by text so they don't collide.
    hard_examples = {}       # text -> (last, label)
    for surname, label in combined_hard.items():
        hard_examples.setdefault(surname, (surname, label))
    hard_examples.update(hard_from_voters)   # real voters take precedence

    per_class = {}
    for _, label in hard_examples.values():
        per_class[label] = per_class.get(label, 0) + 1

    keep_easy = min(len(easy), ratio * max(n_pos, 1))
    rng.shuffle(easy)
    easy = easy[:keep_easy]

    rows = []
    for text, last in pos.items():
        rows.append((text, last, target, "voter_seed"))
    for text, (last, label) in hard_examples.items():
        rows.append((text, last, label, "hard_negative"))
    for text, last in easy:
        rows.append((text, last, "other", "voter_random"))

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["text", "last", "label", "source"])
        w.writerows(rows)

    print("\nLabeled training set written:", args.out)
    print(f"  {target:>14}: {n_pos}")
    for label in sorted(per_class):
        print(f"  {label:>14}: {per_class[label]}")
    print(f"  {'other':>14}: {len(easy)}")
    print(f"  {'TOTAL':>14}: {len(rows)}")
    if n_pos < 50:
        print("\nNOTE: very few positives — expand seeds/nepali_surnames.txt or "
              "lower precision to gather more before trusting the model.")


if __name__ == "__main__":
    main()
