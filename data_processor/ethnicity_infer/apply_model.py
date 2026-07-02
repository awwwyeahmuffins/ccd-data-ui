#!/usr/bin/env python3
"""apply_model.py — Stage 5: score the full voter file and emit a tiered,
review-ready list.

Ensembles two LOCAL signals per voter:
  * dict_hit   — surname in the distinctive-Nepali seed (high precision)
  * model_p    — trained model's P(target)            (recall + Nepali/Indian
                 discrimination)

Tiers (transparent, tune the thresholds in TIER_* below):
  HIGH    — dict_hit AND model agrees, OR model very confident alone
  MEDIUM  — model moderately confident, OR dict_hit the model DOESN'T back
            (this bucket is your Nepali/Indian false-positive catcher — review it)
  (rows below MEDIUM are dropped)

Output: nepalese_flagged.csv, sorted by model_p desc. Treat it as an estimate
with confidence, not ground truth — name inference is probabilistic.

Usage:
    python3 apply_model.py
    python3 apply_model.py --hi 0.85 --med 0.45
"""
import argparse
import json
import os

import joblib
import pandas as pd

import names_common as nc

HERE = nc.HERE


def resolve(p):
    if os.path.isabs(p):
        return p
    here = os.path.join(HERE, p)
    return here if os.path.exists(here) else os.path.join(nc.ROOT, p)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--model", default=os.path.join(HERE, "model.joblib"))
    ap.add_argument("--voter-file", default=None)
    ap.add_argument("--out", default=None, help="default: <target>_flagged.csv")
    ap.add_argument("--hi", type=float, default=0.80, help="HIGH model_p threshold")
    ap.add_argument("--med", type=float, default=0.45, help="MEDIUM model_p threshold")
    ap.add_argument("--chunksize", type=int, default=100_000)
    args = ap.parse_args()

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)
    cols = cfg["columns"]
    target = cfg["target"]
    eth = cfg["ethnicities"][target]
    seed_pos = nc.load_seed_set(resolve(eth["seed_surnames"]))

    bundle = joblib.load(args.model)
    pipe, classes = bundle["pipeline"], bundle["classes"]
    tgt_idx = classes.index(bundle["target"])

    voter_file = resolve(args.voter_file or cfg["voter_file"])
    out = args.out or os.path.join(HERE, f"{target}_flagged.csv")

    usecols = [cols[k] for k in ("id", "last", "first", "address", "city",
                                 "zip", "precinct")]
    counts = {"HIGH": 0, "MEDIUM": 0}
    flagged = []

    print(f"Scoring {voter_file} (thresholds: HIGH>={args.hi}, MEDIUM>={args.med})")
    reader = pd.read_csv(voter_file, usecols=usecols, dtype=str,
                         chunksize=args.chunksize, keep_default_na=False)
    total = 0
    for chunk in reader:
        total += len(chunk)
        texts = [nc.name_text(f, l) for f, l in
                 zip(chunk[cols["first"]], chunk[cols["last"]])]
        proba = pipe.predict_proba(texts)[:, tgt_idx]
        for i, (_, row) in enumerate(chunk.iterrows()):
            p = float(proba[i])
            hit = nc.dict_hit(row[cols["last"]], seed_pos)
            if (hit and p >= args.med) or p >= args.hi:
                tier = "HIGH"
            elif p >= args.med or hit:
                tier = "MEDIUM"
            else:
                continue
            counts[tier] += 1
            flagged.append({
                "VoterID": row[cols["id"]],
                "name": f"{row[cols['first']]} {row[cols['last']]}".strip(),
                "address": row[cols["address"]],
                "city": row[cols["city"]],
                "zip": row[cols["zip"]],
                "precinct": row[cols["precinct"]],
                "dict_hit": int(hit),
                "model_p": round(p, 4),
                "tier": tier,
            })

    out_df = pd.DataFrame(flagged).sort_values(
        ["tier", "model_p"], ascending=[True, False])  # HIGH before MEDIUM
    out_df.to_csv(out, index=False)

    print(f"\nScored {total} voters.")
    print(f"  HIGH  : {counts['HIGH']}")
    print(f"  MEDIUM: {counts['MEDIUM']}  (review — includes dict/model disagreements)")
    print(f"  -> {out}")
    print("\nReminder: probabilistic estimate, reliable in aggregate, noisy per "
          "person. Spot-check the MEDIUM tier before acting on it.")


if __name__ == "__main__":
    main()
