#!/usr/bin/env python3
"""names_common.py — shared name normalization + seed-dictionary matching for
the ethnicity-inference pipeline.

Kept deliberately tiny and dependency-free so build_labels.py, train_model.py
and apply_model.py all featurize names *identically* (train/apply skew here is
the classic way these models silently rot).
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

_NON_ALPHA = re.compile(r"[^a-z ]+")
_WS = re.compile(r"\s+")


def norm(s):
    """Lowercase, drop everything but a-z and spaces, collapse whitespace."""
    s = _NON_ALPHA.sub(" ", (s or "").lower())
    return _WS.sub(" ", s).strip()


def name_text(first, last):
    """The single string the model featurizes: '<first> <last>', normalized.

    Order matters — keep it identical everywhere. We drop middle names; they
    add noise more than signal for origin inference.
    """
    return (norm(first) + " " + norm(last)).strip()


def last_tokens(last):
    """Normalized tokens of a (possibly multi-word) surname, e.g.
    'A GHARBIEH' -> ['a', 'gharbieh']."""
    return norm(last).split()


def load_seed_set(path):
    """Read a seed list file (one surname per line, '#' comments allowed) into a
    lowercase set. Missing file -> empty set (caller decides whether to warn)."""
    out = set()
    if not path or not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip().lower()
            if line:
                out.add(line)
    return out


def dict_hit(last, seedset):
    """True if the surname matches the seed set, as a whole or by any token.
    Token-level catches hyphenated/compound surnames without exploding the seed
    list."""
    if not seedset:
        return False
    toks = last_tokens(last)
    if not toks:
        return False
    if " ".join(toks) in seedset:
        return True
    return any(t in seedset for t in toks)
