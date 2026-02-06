"""
Census Profile Generator

Generates synthetic but realistic census profile data for all Collin County
voting precincts. Data is based on county-wide 2023 ACS benchmarks with
variation across precinct archetypes.

Usage:
    python generate_census_profiles.py
"""

import json
import random
import hashlib
from pathlib import Path

SEED = 42
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
GEOJSON_PATH = DATA_DIR / "Voting_Precincts.geojson"
OUTPUT_PATH = DATA_DIR / "precinct_census_profiles.json"

# ---------------------------------------------------------------------------
# Archetype definitions
# Each archetype represents a cluster of precincts with similar demographics.
# Values are (mean, std_dev) or fixed lists.
# ---------------------------------------------------------------------------

ARCHETYPES = {
    "wealthy_suburban": {
        "weight": 0.30,
        "population": (4500, 1200),
        "populationDensity": (2200, 600),
        "medianAge": (39.5, 3.0),
        "under18": 0.25, "18to34": 0.16, "35to54": 0.30, "55to64": 0.15, "65plus": 0.14,
        "male": (0.49, 0.01),
        "households_per_pop": (0.36, 0.03),
        "familyHouseholdShare": (0.75, 0.05),
        "marriedCoupleShare": (0.82, 0.04),
        "singleParentShare": (0.12, 0.03),
        "averageHHSize": (2.95, 0.20),
        "medianHHI": (145000, 25000),
        "under50k": 0.10, "50kTo100k": 0.18, "100kTo150k": 0.22, "150kTo200k": 0.22, "over200k": 0.28,
        "povertyRate": (0.03, 0.01),
        "highSchoolOrLess": 0.08, "someCollege": 0.16, "bachelors": 0.38, "graduateProfessional": 0.38,
        "laborForce": (0.70, 0.04),
        "unemployment": (0.025, 0.008),
        "ownerOccupied": (0.82, 0.05),
        "medianHomeValue": (520000, 80000),
        "medianRent": (1950, 250),
        "droveAlone": 0.72, "carpooled": 0.06, "publicTransit": 0.01, "workedFromHome": 0.18, "commuteOther": 0.03,
        "meanCommute": (27.0, 4.0),
        "englishOnly": 0.68, "spanish": 0.08, "asianLanguages": 0.16, "langOther": 0.08,
        "veteranShare": (0.05, 0.015),
        "uninsuredRate": (0.04, 0.015),
        "topOccupations": [
            ("Management & Business", 0.26),
            ("Tech & Engineering", 0.22),
            ("Finance & Operations", 0.16),
            ("Healthcare", 0.12),
            ("Education & Legal", 0.10),
        ],
        "topIndustries": [
            ("Professional & Technical Services", 0.22),
            ("Finance & Insurance", 0.15),
            ("Healthcare", 0.10),
            ("Technology", 0.12),
            ("Education", 0.08),
        ],
    },
    "middle_class_family": {
        "weight": 0.35,
        "population": (5200, 1400),
        "populationDensity": (2800, 700),
        "medianAge": (35.5, 3.0),
        "under18": 0.27, "18to34": 0.22, "35to54": 0.28, "55to64": 0.12, "65plus": 0.11,
        "male": (0.49, 0.01),
        "households_per_pop": (0.37, 0.03),
        "familyHouseholdShare": (0.72, 0.05),
        "marriedCoupleShare": (0.72, 0.05),
        "singleParentShare": (0.18, 0.04),
        "averageHHSize": (2.80, 0.20),
        "medianHHI": (95000, 18000),
        "under50k": 0.18, "50kTo100k": 0.30, "100kTo150k": 0.26, "150kTo200k": 0.14, "over200k": 0.12,
        "povertyRate": (0.05, 0.02),
        "highSchoolOrLess": 0.16, "someCollege": 0.24, "bachelors": 0.36, "graduateProfessional": 0.24,
        "laborForce": (0.74, 0.04),
        "unemployment": (0.032, 0.010),
        "ownerOccupied": (0.68, 0.06),
        "medianHomeValue": (380000, 60000),
        "medianRent": (1600, 200),
        "droveAlone": 0.78, "carpooled": 0.08, "publicTransit": 0.02, "workedFromHome": 0.10, "commuteOther": 0.02,
        "meanCommute": (29.0, 4.5),
        "englishOnly": 0.70, "spanish": 0.13, "asianLanguages": 0.10, "langOther": 0.07,
        "veteranShare": (0.06, 0.02),
        "uninsuredRate": (0.06, 0.02),
        "topOccupations": [
            ("Management & Business", 0.20),
            ("Sales & Office", 0.18),
            ("Tech & Engineering", 0.15),
            ("Healthcare", 0.14),
            ("Education & Legal", 0.12),
        ],
        "topIndustries": [
            ("Healthcare", 0.14),
            ("Professional & Technical Services", 0.13),
            ("Retail", 0.11),
            ("Education", 0.10),
            ("Finance & Insurance", 0.10),
        ],
    },
    "diverse_urban": {
        "weight": 0.20,
        "population": (5800, 1500),
        "populationDensity": (3800, 900),
        "medianAge": (33.0, 3.0),
        "under18": 0.24, "18to34": 0.28, "35to54": 0.26, "55to64": 0.12, "65plus": 0.10,
        "male": (0.50, 0.01),
        "households_per_pop": (0.40, 0.04),
        "familyHouseholdShare": (0.58, 0.06),
        "marriedCoupleShare": (0.60, 0.06),
        "singleParentShare": (0.22, 0.05),
        "averageHHSize": (2.55, 0.25),
        "medianHHI": (72000, 15000),
        "under50k": 0.26, "50kTo100k": 0.32, "100kTo150k": 0.22, "150kTo200k": 0.11, "over200k": 0.09,
        "povertyRate": (0.08, 0.03),
        "highSchoolOrLess": 0.22, "someCollege": 0.26, "bachelors": 0.32, "graduateProfessional": 0.20,
        "laborForce": (0.76, 0.04),
        "unemployment": (0.042, 0.012),
        "ownerOccupied": (0.48, 0.08),
        "medianHomeValue": (310000, 50000),
        "medianRent": (1400, 200),
        "droveAlone": 0.74, "carpooled": 0.10, "publicTransit": 0.04, "workedFromHome": 0.08, "commuteOther": 0.04,
        "meanCommute": (30.0, 5.0),
        "englishOnly": 0.55, "spanish": 0.20, "asianLanguages": 0.14, "langOther": 0.11,
        "veteranShare": (0.04, 0.015),
        "uninsuredRate": (0.10, 0.03),
        "topOccupations": [
            ("Sales & Office", 0.20),
            ("Management & Business", 0.16),
            ("Service Occupations", 0.16),
            ("Healthcare", 0.14),
            ("Tech & Engineering", 0.12),
        ],
        "topIndustries": [
            ("Healthcare", 0.14),
            ("Retail", 0.13),
            ("Accommodation & Food Services", 0.11),
            ("Professional & Technical Services", 0.10),
            ("Education", 0.09),
        ],
    },
    "rural_exurban": {
        "weight": 0.15,
        "population": (3200, 900),
        "populationDensity": (800, 400),
        "medianAge": (41.0, 4.0),
        "under18": 0.22, "18to34": 0.17, "35to54": 0.28, "55to64": 0.16, "65plus": 0.17,
        "male": (0.50, 0.01),
        "households_per_pop": (0.35, 0.03),
        "familyHouseholdShare": (0.74, 0.05),
        "marriedCoupleShare": (0.78, 0.05),
        "singleParentShare": (0.14, 0.04),
        "averageHHSize": (2.85, 0.20),
        "medianHHI": (88000, 20000),
        "under50k": 0.20, "50kTo100k": 0.30, "100kTo150k": 0.24, "150kTo200k": 0.14, "over200k": 0.12,
        "povertyRate": (0.06, 0.025),
        "highSchoolOrLess": 0.22, "someCollege": 0.26, "bachelors": 0.30, "graduateProfessional": 0.22,
        "laborForce": (0.68, 0.05),
        "unemployment": (0.035, 0.012),
        "ownerOccupied": (0.80, 0.06),
        "medianHomeValue": (350000, 70000),
        "medianRent": (1450, 250),
        "droveAlone": 0.82, "carpooled": 0.07, "publicTransit": 0.01, "workedFromHome": 0.08, "commuteOther": 0.02,
        "meanCommute": (33.0, 5.0),
        "englishOnly": 0.82, "spanish": 0.10, "asianLanguages": 0.04, "langOther": 0.04,
        "veteranShare": (0.08, 0.025),
        "uninsuredRate": (0.07, 0.025),
        "topOccupations": [
            ("Management & Business", 0.20),
            ("Sales & Office", 0.17),
            ("Construction & Maintenance", 0.14),
            ("Healthcare", 0.12),
            ("Transportation & Production", 0.11),
        ],
        "topIndustries": [
            ("Construction", 0.13),
            ("Healthcare", 0.12),
            ("Retail", 0.11),
            ("Agriculture & Mining", 0.08),
            ("Manufacturing", 0.09),
        ],
    },
}


def load_precinct_codes():
    """Read precinct codes from GeoJSON."""
    with open(GEOJSON_PATH) as f:
        geojson = json.load(f)
    codes = sorted(
        set(feat["properties"]["PRECINCT"] for feat in geojson["features"])
    )
    return codes


def assign_archetype(precinct_code):
    """Deterministically assign a precinct to an archetype based on its code."""
    h = int(hashlib.md5(str(precinct_code).encode()).hexdigest(), 16)
    r = (h % 10000) / 10000.0
    cumulative = 0.0
    for name, cfg in ARCHETYPES.items():
        cumulative += cfg["weight"]
        if r < cumulative:
            return name
    return list(ARCHETYPES.keys())[-1]


def clamp(val, lo, hi):
    return max(lo, min(hi, val))


def noisy(mean, std):
    """Return a normally-distributed value."""
    return random.gauss(mean, std)


def normalize_shares(shares_dict):
    """Normalize a dict of shares so they sum to 1.0."""
    total = sum(shares_dict.values())
    if total == 0:
        return shares_dict
    return {k: round(v / total, 4) for k, v in shares_dict.items()}


def noisy_shares(base_shares, noise=0.03):
    """Add noise to a set of shares and re-normalize."""
    result = {}
    for key, val in base_shares.items():
        result[key] = max(0.001, val + random.gauss(0, noise))
    return normalize_shares(result)


def generate_precinct(precinct_code, archetype_name):
    """Generate a single precinct's census profile."""
    a = ARCHETYPES[archetype_name]

    population = int(clamp(noisy(*a["population"]), 2000, 8000))
    density = int(clamp(noisy(*a["populationDensity"]), 200, 6000))

    # Age
    median_age = round(clamp(noisy(*a.get("medianAge", (36, 3))), 25, 55), 1)
    age_shares = noisy_shares({
        "under18": a["under18"],
        "18to34": a["18to34"],
        "35to54": a["35to54"],
        "55to64": a["55to64"],
        "65plus": a["65plus"],
    }, noise=0.025)

    # Gender
    male_share = round(clamp(noisy(*a["male"]), 0.46, 0.54), 4)
    female_share = round(1.0 - male_share, 4)

    # Households
    hh_ratio = clamp(noisy(*a["households_per_pop"]), 0.25, 0.50)
    total_hh = int(population * hh_ratio)
    family_share = clamp(noisy(*a["familyHouseholdShare"]), 0.40, 0.90)
    family_hh = int(total_hh * family_share)
    married_share = clamp(noisy(*a["marriedCoupleShare"]), 0.45, 0.95)
    married = int(family_hh * married_share)
    sp_share = clamp(noisy(*a["singleParentShare"]), 0.05, 0.35)
    single_parent = int(family_hh * sp_share)
    non_family = total_hh - family_hh
    avg_size = round(clamp(noisy(*a["averageHHSize"]), 1.8, 3.8), 2)

    # Income
    median_hhi = int(clamp(noisy(*a["medianHHI"]), 35000, 250000))
    # Round to nearest 500
    median_hhi = round(median_hhi / 500) * 500
    income_brackets = noisy_shares({
        "under50k": a["under50k"],
        "50kTo100k": a["50kTo100k"],
        "100kTo150k": a["100kTo150k"],
        "150kTo200k": a["150kTo200k"],
        "over200k": a["over200k"],
    }, noise=0.03)
    poverty_rate = round(clamp(noisy(*a["povertyRate"]), 0.01, 0.18), 4)

    # Education
    edu = noisy_shares({
        "highSchoolOrLess": a["highSchoolOrLess"],
        "someCollege": a["someCollege"],
        "bachelors": a["bachelors"],
        "graduateProfessional": a["graduateProfessional"],
    }, noise=0.03)

    # Employment
    labor_force = round(clamp(noisy(*a["laborForce"]), 0.50, 0.90), 4)
    unemp_rate = round(clamp(noisy(*a["unemployment"]), 0.01, 0.10), 4)

    # Occupations and industries with noise
    def noisy_ranked(items, noise=0.02):
        result = []
        for name, share in items:
            s = round(clamp(share + random.gauss(0, noise), 0.03, 0.35), 2)
            result.append({"name": name, "share": s})
        # Normalize
        total = sum(r["share"] for r in result)
        for r in result:
            r["share"] = round(r["share"] / total * sum(s for _, s in items), 2)
        return result

    top_occs = noisy_ranked(a["topOccupations"])
    top_inds = noisy_ranked(a["topIndustries"])

    # Housing
    owner_occ = round(clamp(noisy(*a["ownerOccupied"]), 0.25, 0.95), 4)
    renter_occ = round(1.0 - owner_occ, 4)
    median_home = int(clamp(noisy(*a["medianHomeValue"]), 150000, 900000))
    median_home = round(median_home / 1000) * 1000
    median_rent = int(clamp(noisy(*a["medianRent"]), 800, 3000))
    median_rent = round(median_rent / 25) * 25

    # Commute
    commute_shares = noisy_shares({
        "droveAlone": a["droveAlone"],
        "carpooled": a["carpooled"],
        "publicTransit": a["publicTransit"],
        "workedFromHome": a["workedFromHome"],
        "other": a["commuteOther"],
    }, noise=0.02)
    mean_commute = round(clamp(noisy(*a["meanCommute"]), 12, 50), 1)

    # Language
    lang_shares = noisy_shares({
        "englishOnly": a["englishOnly"],
        "spanish": a["spanish"],
        "asianLanguages": a["asianLanguages"],
        "other": a["langOther"],
    }, noise=0.03)

    # Veterans
    vet_share = round(clamp(noisy(*a["veteranShare"]), 0.01, 0.15), 4)
    # Approximate veteran total from adult population
    adult_share = 1.0 - age_shares.get("under18", 0.24)
    vet_total = int(population * adult_share * vet_share)

    # Insurance
    uninsured = round(clamp(noisy(*a["uninsuredRate"]), 0.01, 0.18), 4)
    insured = round(1.0 - uninsured, 4)

    return {
        "population": population,
        "populationDensity": density,
        "age": {
            "under18": age_shares["under18"],
            "18to34": age_shares["18to34"],
            "35to54": age_shares["35to54"],
            "55to64": age_shares["55to64"],
            "65plus": age_shares["65plus"],
            "medianAge": median_age,
        },
        "gender": {"male": male_share, "female": female_share},
        "households": {
            "total": total_hh,
            "familyHouseholds": family_hh,
            "marriedCouples": married,
            "singleParent": single_parent,
            "nonFamily": non_family,
            "averageSize": avg_size,
        },
        "income": {
            "medianHousehold": median_hhi,
            "brackets": income_brackets,
            "povertyRate": poverty_rate,
        },
        "education": edu,
        "employment": {
            "laborForceParticipation": labor_force,
            "unemploymentRate": unemp_rate,
            "topOccupations": top_occs,
            "topIndustries": top_inds,
        },
        "housing": {
            "ownerOccupied": owner_occ,
            "renterOccupied": renter_occ,
            "medianHomeValue": median_home,
            "medianRent": median_rent,
        },
        "commute": {
            "droveAlone": commute_shares["droveAlone"],
            "carpooled": commute_shares["carpooled"],
            "publicTransit": commute_shares["publicTransit"],
            "workedFromHome": commute_shares["workedFromHome"],
            "other": commute_shares["other"],
            "meanCommuteMinutes": mean_commute,
        },
        "language": lang_shares,
        "veterans": {"total": vet_total, "share": vet_share},
        "insurance": {"insured": insured, "uninsured": uninsured},
    }


def main():
    random.seed(SEED)

    precinct_codes = load_precinct_codes()
    print(f"Loaded {len(precinct_codes)} precinct codes from GeoJSON")

    # Assign archetypes
    archetype_counts = {}
    profiles = {}

    for code in precinct_codes:
        arch = assign_archetype(code)
        archetype_counts[arch] = archetype_counts.get(arch, 0) + 1
        profiles[str(code)] = generate_precinct(code, arch)

    # Write output
    with open(OUTPUT_PATH, "w") as f:
        json.dump(profiles, f, indent=2)

    print(f"Wrote {len(profiles)} precinct profiles to {OUTPUT_PATH}")
    print(f"File size: {OUTPUT_PATH.stat().st_size / 1024:.1f} KB")
    print()

    # Summary stats
    print("Archetype distribution:")
    for name, count in sorted(archetype_counts.items()):
        print(f"  {name}: {count} ({count/len(precinct_codes)*100:.1f}%)")

    pops = [p["population"] for p in profiles.values()]
    incomes = [p["income"]["medianHousehold"] for p in profiles.values()]
    home_vals = [p["housing"]["medianHomeValue"] for p in profiles.values()]
    print()
    print(f"Population:  min={min(pops)}, max={max(pops)}, "
          f"mean={sum(pops)/len(pops):.0f}, total={sum(pops):,}")
    print(f"Median HHI:  min=${min(incomes):,}, max=${max(incomes):,}, "
          f"mean=${sum(incomes)/len(incomes):,.0f}")
    print(f"Home value:  min=${min(home_vals):,}, max=${max(home_vals):,}, "
          f"mean=${sum(home_vals)/len(home_vals):,.0f}")


if __name__ == "__main__":
    main()
