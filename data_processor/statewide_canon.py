#!/usr/bin/env python3
"""
Canonical identity for Texas STATEWIDE contests across county office-name
variants. County canvasses spell the same contest many ways ("Governor",
"Governor ( 1)", "Governor/Write-In"; "Justice, Supreme Court, Place No. 6
Unexpired Term" vs "Justice Supreme Court Pl 6"; the source typo "Railroad
Commissioiner") — without a canonical key, cross-county merges (district
views, the full-Texas view) fragment one contest into per-spelling files.

canonical_statewide_race(office) -> (key, display) or None.
None means "not one of the 13 statewide contest families": this is TIGHTER
than derive_profiles.is_statewide_office — it also rejects regional courts
of appeals ("3rd Ct of App Dist", "7 Th Cad") and impossible seat numbers
(the Supreme Court and Court of Criminal Appeals each have places 1-9 only).
Merging is by identity only — vote rows are never altered.
"""

import re


def _office_key(office):
    return re.sub(r"[^a-z0-9]+", " ", (office or "").lower()).strip()


# Regional intermediate appellate courts are NOT statewide contests.
# Pattern covers:  "Court of Appeals"  •  "Ct of App…"  •  "CAD"
# Also cover numbered CCA variants: "11th Court of Criminal Appeals District"
# is a regional court, not the statewide Texas Court of Criminal Appeals.
APPEALS_RX = re.compile(
    r"\b(court of appeals|ct of app\w*|cad)\b"
    r"|\b\d+\w*\s+court\s+of\s+criminal\s+appeals\b"
    r"|court\s+of\s+criminal\s+appeals\s+district\b"
)

_PLACE_RX = re.compile(r"\bp(?:lace|l)?\.?\s*(?:no\s+)?(\d+)\b")
_TRAILING_NUM_RX = re.compile(r"\b(\d+)\s*$")


def _place(o):
    m = _PLACE_RX.search(o) or _TRAILING_NUM_RX.search(o)
    return int(m.group(1)) if m else None


def canonical_statewide_race(office):
    """(canonical key, canonical display name) for a statewide contest, else None."""
    o = _office_key(office)
    if not o or APPEALS_RX.search(o):
        return None
    if "president" in o:
        return ("president", "President & Vice President")
    if "senat" in o and ("u s" in o or "united states" in o or o.startswith("us senat")):
        return ("us-senator", "United States Senator")
    if "lieutenant governor" in o or "lt governor" in o:
        return ("lt-governor", "Lieutenant Governor")
    if "governor" in o:
        return ("governor", "Governor")
    if "attorney general" in o:
        return ("attorney-general", "Attorney General")
    if "comptroller" in o:
        return ("comptroller", "Comptroller of Public Accounts")
    if "land office" in o or "land commissioner" in o:
        return ("land-commissioner", "Commissioner of the General Land Office")
    if "agriculture" in o:
        return ("agriculture-commissioner", "Commissioner of Agriculture")
    if "railroad" in o:  # absorbs the "Railroad Commissioiner" source typo
        return ("railroad-commissioner", "Railroad Commissioner")
    if "criminal appeals" in o:
        if "presiding" in o:
            return ("cca-presiding-judge", "Presiding Judge, Court of Criminal Appeals")
        n = _place(o)
        if n and 1 <= n <= 9:
            return (f"cca-place-{n}", f"Judge, Court of Criminal Appeals, Place {n}")
        return None
    if "chief justice" in o and "sup" in o:
        return ("chief-justice-supreme-court", "Chief Justice, Supreme Court")
    if "supreme court" in o or "sup court" in o:
        n = _place(o)
        if n and 1 <= n <= 9:
            return (f"supreme-court-place-{n}", f"Justice, Supreme Court, Place {n}")
        return None
    return None
