# ethnicity_infer — name-origin inference over the voter file

Estimates likely national origin from voter names (no ethnicity field exists in
the data) using **distant supervision** + a local **char-n-gram classifier**.
Fully local, CPU-only, trains in seconds. Built first for **Nepalese**;
expandable to any origin by editing `config.json` + dropping two seed lists.

> ⚠️ Output is a **probabilistic estimate** — reliable in aggregate (e.g. precinct
> turnout, outreach sizing), noisy per individual. The Nepali/Indian boundary is
> the hardest case. Always spot-check before acting; never treat a flag as fact.

## Pipeline

```
seeds/  +  VoterRegistrationFile.txt
      │
      ▼  build_labels.py        distant supervision -> training_data.csv
      │     positives  = voters whose surname is in seeds/nepali_surnames.txt
      │     hard negs  = seeds/indian_surnames.txt (+ Indian voters)  ← teaches the boundary
      │     easy negs  = random sample of everyone else
      ▼  train_model.py         char_wb 2-4gram TF-IDF + LogisticRegression -> model.joblib
      │     validated on a SURNAME-disjoint holdout (honest "did it find NEW people" metric)
      ▼  apply_model.py         ensemble (dict_hit + model_p) -> <target>_flagged.csv (HIGH / MEDIUM)
```

## Run it

```bash
cd data_processor/ethnicity_infer
python3 build_labels.py        # -> training_data.csv
python3 train_model.py         # -> model.joblib  (read the holdout report!)
python3 apply_model.py         # -> nepalese_flagged.csv
```

Threshold knobs: `python3 apply_model.py --hi 0.85 --med 0.50`
(higher = fewer, cleaner flags).

## Add another ethnicity

No code changes. In `config.json`:
1. add a block under `ethnicities` (seed surnames + hard-negative list + label),
2. set `target` to its key,
3. create `seeds/<origin>_surnames.txt` (distinctive, high-precision) and a
   hard-negative list (the *confusable* neighbor origin — that contrast is what
   makes it work),
4. re-run the three scripts.

## Accuracy levers (in priority order)

1. **Bigger, more diverse hard negatives.** `seeds/indian_surnames.txt` is a
   small starter. Most MEDIUM-tier false positives are Pakistani / Bangladeshi /
   Muslim / MENA names the model hasn't been taught. Append larger public name
   lists for those origins → precision jumps.
2. **Expand the positive seed** (`seeds/nepali_surnames.txt`) with more
   distinctive Nepali surnames → more & cleaner positives.
3. **Tighten tiers** — require `dict_hit` for HIGH if you want a near-zero-FP
   list (edit the tier logic in `apply_model.py`).

## Files
- `config.json` — target, paths, column map, thresholds
- `seeds/` — surname seed lists (edit these freely)
- `names_common.py` — shared normalization (keeps train/apply identical)
- `build_labels.py` / `train_model.py` / `apply_model.py` — the three stages
- `training_data.csv`, `model.joblib`, `nepalese_flagged.csv` — generated (gitignore-worthy)
