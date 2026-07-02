#!/usr/bin/env python3
"""train_model.py — Stage 3+4: train a char-n-gram classifier on the labeled
set and validate it HONESTLY.

Model: TfidfVectorizer(char_wb, 2-4grams) -> LogisticRegression(balanced).
CPU-only, trains in seconds on a laptop.

The honest part: we split by SURNAME (GroupShuffleSplit), so every surname in
the test set is one the model never saw in training. That measures whether the
model generalizes via subword patterns + given names — i.e. whether it found
*new* people — instead of just memorizing the seed list (which would be
circular and useless). The target-class precision/recall printed under
"novel-surname holdout" is the number that actually matters.

Output: model.joblib  (vectorizer + classifier + target label)

Usage:
    python3 train_model.py
"""
import argparse
import json
import os

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline

import names_common as nc

HERE = nc.HERE


def build_pipeline():
    return Pipeline([
        ("vec", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4),
                                min_df=2, sublinear_tf=True)),
        ("clf", LogisticRegression(max_iter=2000, class_weight="balanced",
                                   C=4.0)),
    ])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--data", default=os.path.join(HERE, "training_data.csv"))
    ap.add_argument("--out", default=os.path.join(HERE, "model.joblib"))
    ap.add_argument("--test-frac", type=float, default=0.2)
    args = ap.parse_args()

    with open(args.config, encoding="utf-8") as f:
        target = json.load(f)["target"]

    df = pd.read_csv(args.data, dtype=str, keep_default_na=False)
    df = df[df["text"].str.strip() != ""].reset_index(drop=True)
    print(f"Loaded {len(df)} labeled examples | classes: "
          f"{dict(df['label'].value_counts())}")

    X, y, groups = df["text"].values, df["label"].values, df["last"].values

    # --- honest, group-by-surname holdout ---
    gss = GroupShuffleSplit(n_splits=1, test_size=args.test_frac, random_state=42)
    tr, te = next(gss.split(X, y, groups))
    pipe = build_pipeline()
    pipe.fit(X[tr], y[tr])

    print("\n=== novel-surname holdout (surnames unseen in training) ===")
    print(classification_report(y[te], pipe.predict(X[te]), zero_division=0,
                                digits=3))
    print("^ Look at the '%s' row. Recall here = real new people found; "
          "precision = how many flagged are right." % target)

    # --- refit on everything for the production model ---
    final = build_pipeline()
    final.fit(X, y)
    joblib.dump({"pipeline": final, "target": target,
                 "classes": list(final.named_steps["clf"].classes_)}, args.out)
    print(f"\nFinal model trained on all {len(df)} rows -> {args.out}")
    print("Classes:", list(final.named_steps["clf"].classes_))


if __name__ == "__main__":
    main()
