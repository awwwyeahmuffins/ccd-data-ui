"""
Fetch Real ACS Census Data for Precinct Profiles

Replaces synthetic census profiles with real American Community Survey data
from the Census Bureau API, aggregated from block groups to precincts via
area-weighted spatial join.

Pipeline:
  A. Download TIGER/Line block group shapefile, spatial join with precincts
  B. Query Census ACS 5-year API for all needed variables
  C. Aggregate block group data to precinct level using area weights
  D. Output JSON in the same format the UI consumes

Usage:
    python data_processor/fetch_acs_profiles.py
    python data_processor/fetch_acs_profiles.py --skip-download   # reuse cached shapefile
    python data_processor/fetch_acs_profiles.py --crosswalk-only  # only build crosswalk
"""

import argparse
import csv
import io
import json
import logging
import sys
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PRECINCT_GEOJSON = DATA_DIR / "Voting_Precincts.geojson"
CROSSWALK_OUT = DATA_DIR / "precinct_to_bg_crosswalk.csv"
OUTPUT_PATH = DATA_DIR / "precinct_census_profiles.json"
OUTPUT_2026 = DATA_DIR / "2026" / "precinct_census_profiles.json"
VOTER_CROSSWALK = DATA_DIR / "crosswalk_voter_based.csv"

TIGER_URL = "https://www2.census.gov/geo/tiger/TIGER2024/BG/tl_2024_48_bg.zip"
TIGER_CACHE = DATA_DIR / "cache" / "tl_2024_48_bg.zip"

# Texas State Plane North Central (feet) — matches remap_precincts.py
EPSG_PROJECTED = 2276

# Collin County FIPS
STATE_FIPS = "48"
COUNTY_FIPS = "085"

# ACS 5-year dataset
ACS_YEAR = 2023
ACS_BASE = f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"

# ---------------------------------------------------------------------------
# ACS Variable Definitions
# ---------------------------------------------------------------------------

# Age detail variables: B01001 male (003-025) + female (027-049)
# Male age brackets:
#   003: Under 5, 004: 5-9, 005: 10-14, 006: 15-17
#   007: 18-19, 008: 20, 009: 21, 010: 22-24, 011: 25-29, 012: 30-34
#   013: 35-39, 014: 40-44, 015: 45-49, 016: 50-54
#   017: 55-59, 018: 60-61, 019: 62-64
#   020: 65-66, 021: 67-69, 022: 70-74, 023: 75-79, 024: 80-84, 025: 85+
# Female offsets are +24 (027-049)

AGE_MALE_UNDER18 = [f"B01001_{i:03d}E" for i in range(3, 7)]   # 003-006
AGE_MALE_18_34 = [f"B01001_{i:03d}E" for i in range(7, 13)]    # 007-012
AGE_MALE_35_54 = [f"B01001_{i:03d}E" for i in range(13, 17)]   # 013-016
AGE_MALE_55_64 = [f"B01001_{i:03d}E" for i in range(17, 20)]   # 017-019
AGE_MALE_65PLUS = [f"B01001_{i:03d}E" for i in range(20, 26)]  # 020-025

AGE_FEMALE_UNDER18 = [f"B01001_{i:03d}E" for i in range(27, 31)]  # 027-030
AGE_FEMALE_18_34 = [f"B01001_{i:03d}E" for i in range(31, 37)]    # 031-036
AGE_FEMALE_35_54 = [f"B01001_{i:03d}E" for i in range(37, 41)]    # 037-040
AGE_FEMALE_55_64 = [f"B01001_{i:03d}E" for i in range(41, 44)]    # 041-043
AGE_FEMALE_65PLUS = [f"B01001_{i:03d}E" for i in range(44, 50)]   # 044-049

# Income bracket variables: B19001_002E through B19001_017E (16 brackets)
INCOME_BRACKET_VARS = [f"B19001_{i:03d}E" for i in range(2, 18)]

# Education variables: B15003 (population 25+ by educational attainment)
# 002-016: less than HS diploma, 017: HS diploma, 018: GED
# 019: some college <1yr, 020: some college 1+ no degree, 021: associate's
# 022: bachelor's, 023: master's, 024: professional, 025: doctorate
EDU_TOTAL = "B15003_001E"
EDU_HS_OR_LESS = [f"B15003_{i:03d}E" for i in range(2, 19)]     # 002-018
EDU_SOME_COLLEGE = [f"B15003_{i:03d}E" for i in range(19, 22)]  # 019-021
EDU_BACHELORS = ["B15003_022E"]
EDU_GRADUATE = [f"B15003_{i:03d}E" for i in range(23, 26)]      # 023-025

# Commute variables: B08301 (means of transportation to work)
# 002: drove alone, 003: 2-person carpool ... 004: 3-person ... etc
# We'll group carpooled = 004+005+006 (but ACS uses 003 for 'car,truck,van-carpooled')
# Actually B08301: 001=total, 002=car/truck/van drove alone, 003=car/truck/van carpooled
# 010=public transit total, 019=walked, 020=other, 021=worked at home

# Language: B16001 (language spoken at home, pop 5+)
# 001=total, 002=english only, 003=spanish, ...
# Asian languages need summing several vars

# Occupation: C24010 (sex by occupation for civilian employed pop 16+)
# Industry: C24030 (sex by industry)

# Insurance: B27001 (health insurance coverage)
# 001=total, then by age bracket: odd-numbered = with coverage, even = without

# Veterans: B21001 (sex by veteran status, civilian pop 18+)
# 001=total, 002=veteran

# ---------------------------------------------------------------------------
# Batch 1: Core demographics, households, income
BATCH_1_VARS = [
    "B01003_001E",   # total population
    "B01002_001E",   # median age
    "B01001_002E",   # male total
    "B01001_026E",   # female total
    "B11001_001E",   # total households
    "B11001_002E",   # family households
    "B11001_007E",   # nonfamily households
    "B11003_001E",   # family type total
    "B11003_002E",   # married-couple family
    "B11003_007E",   # male householder no spouse
    "B11003_013E",   # female householder no spouse
    "B25010_001E",   # average household size
    "B19013_001E",   # median household income
    "B17001_001E",   # poverty status total
    "B17001_002E",   # income below poverty
] + INCOME_BRACKET_VARS

# Batch 2: Age detail (male brackets)
BATCH_2_VARS = (
    AGE_MALE_UNDER18 + AGE_MALE_18_34 + AGE_MALE_35_54 +
    AGE_MALE_55_64 + AGE_MALE_65PLUS
)

# Batch 3: Age detail (female brackets)
BATCH_3_VARS = (
    AGE_FEMALE_UNDER18 + AGE_FEMALE_18_34 + AGE_FEMALE_35_54 +
    AGE_FEMALE_55_64 + AGE_FEMALE_65PLUS
)

# Batch 4: Education + Employment
BATCH_4_VARS = [
    EDU_TOTAL,
] + EDU_HS_OR_LESS + EDU_SOME_COLLEGE + EDU_BACHELORS + EDU_GRADUATE + [
    "B23025_001E",   # employment status total (pop 16+)
    "B23025_002E",   # in labor force
    "B23025_005E",   # unemployed
]

# Batch 5: Housing + Commute
BATCH_5_VARS = [
    "B25003_001E",   # tenure total
    "B25003_002E",   # owner occupied
    "B25003_003E",   # renter occupied
    "B25077_001E",   # median home value
    "B25064_001E",   # median gross rent
    "B08301_001E",   # commute total
    "B08301_002E",   # drove alone
    "B08301_003E",   # carpooled (total)
    "B08301_010E",   # public transit (total)
    "B08301_019E",   # walked
    "B08301_020E",   # other means
    "B08301_021E",   # worked at home
    "B08303_001E",   # travel time total
    "B08135_001E",   # aggregate travel time to work (minutes)
]

# Batch 6: Language
BATCH_6_VARS = [
    "B16001_001E",   # language total (pop 5+)
    "B16001_002E",   # english only
    "B16001_003E",   # spanish
    # Asian/Pacific Island languages - sum several
    "B16001_015E",   # Chinese
    "B16001_018E",   # Vietnamese
    "B16001_021E",   # Korean
    "B16001_024E",   # Hmong
    "B16001_012E",   # Japanese
    "B16001_027E",   # Hindi
    "B16001_030E",   # Urdu
    "B16001_033E",   # Gujarati
    "B16001_036E",   # Other Indic
    "B16001_039E",   # Tagalog
    "B16001_042E",   # Other Asian
]

# Batch 7: Veterans, Insurance
BATCH_7_VARS = [
    "B21001_001E",   # civilian pop 18+ total
    "B21001_002E",   # veterans
    "B27001_001E",   # insurance total
    # With insurance by age
    "B27001_004E",   # under 6 with
    "B27001_007E",   # 6-18 with
    "B27001_010E",   # 19-25 with
    "B27001_013E",   # 26-34 with
    "B27001_016E",   # 35-44 with
    "B27001_019E",   # 45-54 with
    "B27001_022E",   # 55-64 with
    "B27001_025E",   # 65-74 with
    "B27001_028E",   # 75+ with
    # Without insurance by age
    "B27001_005E",   # under 6 without
    "B27001_008E",   # 6-18 without
    "B27001_011E",   # 19-25 without
    "B27001_014E",   # 26-34 without
    "B27001_017E",   # 35-44 without
    "B27001_020E",   # 45-54 without
    "B27001_023E",   # 55-64 without
    "B27001_026E",   # 65-74 without
    "B27001_029E",   # 75+ without
]

# Batch 8: Occupations (C24010 - civilian employed pop 16+)
# Male: 003=mgmt/biz/sci/arts, 019=service, 027=sales/office, 030=natural resources/construction/maint, 034=production/transport
# Female: 039=mgmt, 055=service, 063=sales/office, 066=natural resources, 070=production
BATCH_8_VARS = [
    "C24010_001E",   # total
    "C24010_003E",   # male: management, business, science, arts
    "C24010_019E",   # male: service
    "C24010_027E",   # male: sales and office
    "C24010_030E",   # male: natural resources, construction, maintenance
    "C24010_034E",   # male: production, transportation, material moving
    "C24010_039E",   # female: management, business, science, arts
    "C24010_055E",   # female: service
    "C24010_063E",   # female: sales and office
    "C24010_066E",   # female: natural resources, construction, maintenance
    "C24010_070E",   # female: production, transportation, material moving
]

# Batch 9: Industries (C24030 - industry by sex)
BATCH_9_VARS = [
    "C24030_001E",   # total
    # Male industries
    "C24030_003E",   # agriculture/mining
    "C24030_006E",   # construction
    "C24030_007E",   # manufacturing
    "C24030_008E",   # wholesale trade
    "C24030_009E",   # retail trade
    "C24030_010E",   # transportation/warehousing/utilities
    "C24030_013E",   # information
    "C24030_014E",   # finance/insurance/real estate
    "C24030_017E",   # professional/scientific/management/admin/waste mgmt
    "C24030_021E",   # educational services/health care/social assistance
    "C24030_024E",   # arts/entertainment/recreation/accommodation/food services
    "C24030_027E",   # other services
    "C24030_028E",   # public administration
    # Female industries
    "C24030_030E",   # agriculture/mining
    "C24030_033E",   # construction
    "C24030_034E",   # manufacturing
    "C24030_035E",   # wholesale trade
    "C24030_036E",   # retail trade
    "C24030_037E",   # transportation/warehousing/utilities
    "C24030_040E",   # information
    "C24030_041E",   # finance/insurance/real estate
    "C24030_044E",   # professional/scientific/management/admin/waste mgmt
    "C24030_048E",   # educational services/health care/social assistance
    "C24030_051E",   # arts/entertainment/recreation/accommodation/food services
    "C24030_054E",   # other services
    "C24030_055E",   # public administration
]

ALL_BATCHES = [
    BATCH_1_VARS, BATCH_2_VARS, BATCH_3_VARS, BATCH_4_VARS,
    BATCH_5_VARS, BATCH_6_VARS, BATCH_7_VARS, BATCH_8_VARS,
    BATCH_9_VARS,
]

# ---------------------------------------------------------------------------
# Phase A: Build precinct ↔ block group crosswalk
# ---------------------------------------------------------------------------

def download_tiger_shapefile(skip_download=False):
    """Download and extract TIGER/Line block group shapefile for Texas."""
    TIGER_CACHE.parent.mkdir(parents=True, exist_ok=True)

    if skip_download and TIGER_CACHE.exists():
        logger.info(f"Using cached TIGER shapefile: {TIGER_CACHE}")
    else:
        logger.info(f"Downloading TIGER/Line block groups for Texas...")
        resp = requests.get(TIGER_URL, stream=True, timeout=120)
        resp.raise_for_status()
        with open(TIGER_CACHE, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        logger.info(f"Downloaded {TIGER_CACHE.stat().st_size / 1024 / 1024:.1f} MB")

    # Extract to temp dir and read
    tmpdir = tempfile.mkdtemp(prefix="tiger_bg_")
    with zipfile.ZipFile(TIGER_CACHE) as zf:
        zf.extractall(tmpdir)

    shp_files = list(Path(tmpdir).glob("*.shp"))
    if not shp_files:
        raise FileNotFoundError(f"No .shp file found in {tmpdir}")

    logger.info(f"Reading shapefile: {shp_files[0].name}")
    gdf = gpd.read_file(shp_files[0])
    return gdf


def build_precinct_bg_crosswalk(skip_download=False):
    """Build area-weighted crosswalk between precincts and Census block groups."""
    logger.info("Loading precinct GeoJSON...")
    precincts = gpd.read_file(PRECINCT_GEOJSON)
    precincts["PRECINCT"] = precincts["PRECINCT"].astype(int)
    logger.info(f"  {len(precincts)} precincts loaded")

    # Load TIGER block groups
    bg_gdf = download_tiger_shapefile(skip_download=skip_download)

    # Filter to Collin County
    bg_gdf = bg_gdf[bg_gdf["COUNTYFP"] == COUNTY_FIPS].copy()
    logger.info(f"  {len(bg_gdf)} block groups in Collin County")

    # Reproject to Texas State Plane for accurate area computation
    precincts_proj = precincts.to_crs(epsg=EPSG_PROJECTED)
    bg_proj = bg_gdf.to_crs(epsg=EPSG_PROJECTED)

    # Compute block group areas before overlay
    bg_proj["bg_area"] = bg_proj.geometry.area

    # Perform overlay (intersection)
    logger.info("Computing spatial overlay (intersection)...")
    overlay = gpd.overlay(precincts_proj, bg_proj, how="intersection")

    # Compute intersection areas and weights
    overlay["intersection_area"] = overlay.geometry.area
    overlay["weight"] = overlay["intersection_area"] / overlay["bg_area"]

    # Build crosswalk DataFrame
    crosswalk = overlay[["PRECINCT", "GEOID", "weight"]].copy()
    crosswalk = crosswalk.rename(columns={"PRECINCT": "precinct", "GEOID": "bg_geoid"})
    crosswalk["bg_geoid"] = crosswalk["bg_geoid"].astype(str)

    # Filter out tiny slivers (< 0.1% of block group)
    crosswalk = crosswalk[crosswalk["weight"] > 0.001].copy()

    # Sort for readability
    crosswalk = crosswalk.sort_values(["precinct", "bg_geoid"]).reset_index(drop=True)

    # Round weights
    crosswalk["weight"] = crosswalk["weight"].round(6)

    logger.info(f"Crosswalk: {len(crosswalk)} precinct-BG pairs")
    logger.info(f"  Block groups used: {crosswalk['bg_geoid'].nunique()}")
    logger.info(f"  Precincts covered: {crosswalk['precinct'].nunique()}")

    # Save
    crosswalk.to_csv(CROSSWALK_OUT, index=False)
    logger.info(f"Saved crosswalk to {CROSSWALK_OUT}")

    return crosswalk


# ---------------------------------------------------------------------------
# Phase B: Query Census ACS API
# ---------------------------------------------------------------------------

def fetch_acs_batch(variables):
    """Fetch a batch of ACS variables at block group level for Collin County."""
    var_str = ",".join(variables)
    url = (
        f"{ACS_BASE}?get={var_str}"
        f"&for=block%20group:*"
        f"&in=state:{STATE_FIPS}%20county:{COUNTY_FIPS}"
    )

    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    # First row is headers, rest is data
    headers = data[0]
    rows = data[1:]

    df = pd.DataFrame(rows, columns=headers)

    # Build GEOID from state+county+tract+block group
    df["GEOID"] = df["state"] + df["county"] + df["tract"] + df["block group"]

    # Convert variable columns to numeric
    for var in variables:
        if var in df.columns:
            df[var] = pd.to_numeric(df[var], errors="coerce")

    return df.set_index("GEOID")


def fetch_all_acs_data():
    """Fetch all ACS variables in batches."""
    logger.info(f"Fetching ACS {ACS_YEAR} 5-year data for Collin County block groups...")

    all_data = None

    for i, batch in enumerate(ALL_BATCHES):
        logger.info(f"  Batch {i+1}/{len(ALL_BATCHES)}: {len(batch)} variables")
        df = fetch_acs_batch(batch)

        if all_data is None:
            all_data = df[batch]
        else:
            # Only add columns we don't already have
            new_cols = [c for c in batch if c not in all_data.columns and c in df.columns]
            if new_cols:
                all_data = all_data.join(df[new_cols], how="outer")

    logger.info(f"  Total: {len(all_data)} block groups, {len(all_data.columns)} variables")
    return all_data


# ---------------------------------------------------------------------------
# Phase C: Aggregate block group data to precincts
# ---------------------------------------------------------------------------

def safe_sum(series):
    """Sum ignoring NaN, return NaN if all NaN."""
    valid = series.dropna()
    if len(valid) == 0:
        return np.nan
    return valid.sum()


def weighted_sum(bg_data, crosswalk_subset, var_names):
    """Compute area-weighted sum for count variables."""
    total = 0.0
    for _, row in crosswalk_subset.iterrows():
        geoid = row["bg_geoid"]
        weight = row["weight"]
        if geoid in bg_data.index:
            vals = bg_data.loc[geoid, var_names] if isinstance(var_names, list) else bg_data.loc[geoid, var_names]
            if isinstance(var_names, list):
                v = vals.sum()
            else:
                v = vals
            if pd.notna(v):
                total += v * weight
    return total


def weighted_median(bg_data, crosswalk_subset, median_var, pop_var):
    """
    Approximate a median by computing a population-weighted average of
    block-group medians. (True median would require microdata.)
    """
    total_val = 0.0
    total_pop = 0.0
    for _, row in crosswalk_subset.iterrows():
        geoid = row["bg_geoid"]
        weight = row["weight"]
        if geoid in bg_data.index:
            med = bg_data.loc[geoid, median_var]
            pop = bg_data.loc[geoid, pop_var]
            if pd.notna(med) and pd.notna(pop) and med > 0 and pop > 0:
                wpop = pop * weight
                total_val += med * wpop
                total_pop += wpop
    if total_pop > 0:
        return total_val / total_pop
    return np.nan


def aggregate_to_precincts(bg_data, crosswalk):
    """Aggregate block group data to precinct level using area weights."""
    logger.info("Aggregating block group data to precincts...")

    profiles = {}
    precinct_ids = sorted(crosswalk["precinct"].unique())

    for pct_id in precinct_ids:
        cw = crosswalk[crosswalk["precinct"] == pct_id]

        # --- Population ---
        population = weighted_sum(bg_data, cw, "B01003_001E")
        if population <= 0 or np.isnan(population):
            logger.warning(f"  Precinct {pct_id}: no population data, skipping")
            continue

        # --- Median Age ---
        median_age = weighted_median(bg_data, cw, "B01002_001E", "B01003_001E")

        # --- Age brackets ---
        under18 = weighted_sum(bg_data, cw, AGE_MALE_UNDER18 + AGE_FEMALE_UNDER18)
        age_18_34 = weighted_sum(bg_data, cw, AGE_MALE_18_34 + AGE_FEMALE_18_34)
        age_35_54 = weighted_sum(bg_data, cw, AGE_MALE_35_54 + AGE_FEMALE_35_54)
        age_55_64 = weighted_sum(bg_data, cw, AGE_MALE_55_64 + AGE_FEMALE_55_64)
        age_65plus = weighted_sum(bg_data, cw, AGE_MALE_65PLUS + AGE_FEMALE_65PLUS)
        age_total = under18 + age_18_34 + age_35_54 + age_55_64 + age_65plus

        # --- Gender ---
        male = weighted_sum(bg_data, cw, "B01001_002E")
        female = weighted_sum(bg_data, cw, "B01001_026E")
        gender_total = male + female

        # --- Households ---
        total_hh = weighted_sum(bg_data, cw, "B11001_001E")
        family_hh = weighted_sum(bg_data, cw, "B11001_002E")
        nonfamily_hh = weighted_sum(bg_data, cw, "B11001_007E")
        married_couples = weighted_sum(bg_data, cw, "B11003_002E")
        single_parent = (
            weighted_sum(bg_data, cw, "B11003_007E") +
            weighted_sum(bg_data, cw, "B11003_013E")
        )
        avg_hh_size = weighted_median(bg_data, cw, "B25010_001E", "B11001_001E")

        # --- Income ---
        median_hhi = weighted_median(bg_data, cw, "B19013_001E", "B11001_001E")
        poverty_total = weighted_sum(bg_data, cw, "B17001_001E")
        poverty_below = weighted_sum(bg_data, cw, "B17001_002E")

        # Income brackets: collapse 16 ACS brackets into 5
        # Under 50k: brackets 002-010 (Less than $10K through $45-50K)
        inc_under50k = weighted_sum(bg_data, cw, [f"B19001_{i:03d}E" for i in range(2, 11)])
        # 50k-100k: brackets 011-013 ($50-60K, $60-75K, $75-100K)
        inc_50_100 = weighted_sum(bg_data, cw, [f"B19001_{i:03d}E" for i in range(11, 14)])
        # 100k-150k: brackets 014-015 ($100-125K, $125-150K)
        inc_100_150 = weighted_sum(bg_data, cw, [f"B19001_{i:03d}E" for i in range(14, 16)])
        # 150k-200k: bracket 016 ($150-200K)
        inc_150_200 = weighted_sum(bg_data, cw, "B19001_016E")
        # Over 200k: bracket 017 ($200K+)
        inc_over200 = weighted_sum(bg_data, cw, "B19001_017E")
        inc_total = inc_under50k + inc_50_100 + inc_100_150 + inc_150_200 + inc_over200

        # --- Education ---
        edu_total = weighted_sum(bg_data, cw, EDU_TOTAL)
        edu_hs = weighted_sum(bg_data, cw, EDU_HS_OR_LESS)
        edu_some = weighted_sum(bg_data, cw, EDU_SOME_COLLEGE)
        edu_bach = weighted_sum(bg_data, cw, EDU_BACHELORS)
        edu_grad = weighted_sum(bg_data, cw, EDU_GRADUATE)

        # --- Employment ---
        emp_total = weighted_sum(bg_data, cw, "B23025_001E")
        labor_force = weighted_sum(bg_data, cw, "B23025_002E")
        unemployed = weighted_sum(bg_data, cw, "B23025_005E")

        # --- Housing ---
        tenure_total = weighted_sum(bg_data, cw, "B25003_001E")
        owner = weighted_sum(bg_data, cw, "B25003_002E")
        renter = weighted_sum(bg_data, cw, "B25003_003E")
        median_home = weighted_median(bg_data, cw, "B25077_001E", "B25003_002E")
        median_rent = weighted_median(bg_data, cw, "B25064_001E", "B25003_003E")

        # --- Commute ---
        commute_total = weighted_sum(bg_data, cw, "B08301_001E")
        drove_alone = weighted_sum(bg_data, cw, "B08301_002E")
        carpooled = weighted_sum(bg_data, cw, "B08301_003E")
        transit = weighted_sum(bg_data, cw, "B08301_010E")
        walked = weighted_sum(bg_data, cw, "B08301_019E")
        other_commute = weighted_sum(bg_data, cw, "B08301_020E")
        wfh = weighted_sum(bg_data, cw, "B08301_021E")

        # Mean commute: aggregate travel time / workers who commute
        agg_travel = weighted_sum(bg_data, cw, "B08135_001E")
        commuters = commute_total - wfh if commute_total > wfh else commute_total
        mean_commute = agg_travel / commuters if commuters > 0 else np.nan

        # --- Language ---
        lang_total = weighted_sum(bg_data, cw, "B16001_001E")
        english_only = weighted_sum(bg_data, cw, "B16001_002E")
        spanish = weighted_sum(bg_data, cw, "B16001_003E")
        asian_langs = weighted_sum(bg_data, cw, [
            "B16001_012E", "B16001_015E", "B16001_018E", "B16001_021E",
            "B16001_024E", "B16001_027E", "B16001_030E", "B16001_033E",
            "B16001_036E", "B16001_039E", "B16001_042E",
        ])

        # --- Veterans ---
        vet_total_pop = weighted_sum(bg_data, cw, "B21001_001E")
        veterans = weighted_sum(bg_data, cw, "B21001_002E")

        # --- Insurance ---
        ins_total = weighted_sum(bg_data, cw, "B27001_001E")
        insured_vars = [
            "B27001_004E", "B27001_007E", "B27001_010E", "B27001_013E",
            "B27001_016E", "B27001_019E", "B27001_022E", "B27001_025E",
            "B27001_028E",
        ]
        uninsured_vars = [
            "B27001_005E", "B27001_008E", "B27001_011E", "B27001_014E",
            "B27001_017E", "B27001_020E", "B27001_023E", "B27001_026E",
            "B27001_029E",
        ]
        insured = weighted_sum(bg_data, cw, insured_vars)
        uninsured = weighted_sum(bg_data, cw, uninsured_vars)

        # --- Occupations ---
        occ_total = weighted_sum(bg_data, cw, "C24010_001E")
        occ_mgmt = (
            weighted_sum(bg_data, cw, "C24010_003E") +
            weighted_sum(bg_data, cw, "C24010_039E")
        )
        occ_service = (
            weighted_sum(bg_data, cw, "C24010_019E") +
            weighted_sum(bg_data, cw, "C24010_055E")
        )
        occ_sales = (
            weighted_sum(bg_data, cw, "C24010_027E") +
            weighted_sum(bg_data, cw, "C24010_063E")
        )
        occ_resources = (
            weighted_sum(bg_data, cw, "C24010_030E") +
            weighted_sum(bg_data, cw, "C24010_066E")
        )
        occ_production = (
            weighted_sum(bg_data, cw, "C24010_034E") +
            weighted_sum(bg_data, cw, "C24010_070E")
        )

        # --- Industries ---
        ind_total = weighted_sum(bg_data, cw, "C24030_001E")
        # Sum male + female for each industry
        ind_pairs = [
            ("Agriculture & Mining", "C24030_003E", "C24030_030E"),
            ("Construction", "C24030_006E", "C24030_033E"),
            ("Manufacturing", "C24030_007E", "C24030_034E"),
            ("Wholesale Trade", "C24030_008E", "C24030_035E"),
            ("Retail", "C24030_009E", "C24030_036E"),
            ("Transportation & Utilities", "C24030_010E", "C24030_037E"),
            ("Information", "C24030_013E", "C24030_040E"),
            ("Finance & Insurance", "C24030_014E", "C24030_041E"),
            ("Professional & Technical Services", "C24030_017E", "C24030_044E"),
            ("Education & Healthcare", "C24030_021E", "C24030_048E"),
            ("Accommodation & Food Services", "C24030_024E", "C24030_051E"),
            ("Other Services", "C24030_027E", "C24030_054E"),
            ("Public Administration", "C24030_028E", "C24030_055E"),
        ]

        industries = {}
        for name, male_var, female_var in ind_pairs:
            industries[name] = (
                weighted_sum(bg_data, cw, male_var) +
                weighted_sum(bg_data, cw, female_var)
            )

        # ========== Build profile ==========

        def safe_share(num, denom):
            if denom > 0 and pd.notna(num):
                return round(num / denom, 4)
            return 0.0

        def safe_round(val, decimals=1):
            if pd.notna(val):
                return round(float(val), decimals)
            return None

        # Build top occupations (sorted by share, top 5)
        occ_items = [
            ("Management & Business", occ_mgmt),
            ("Service Occupations", occ_service),
            ("Sales & Office", occ_sales),
            ("Construction & Maintenance", occ_resources),
            ("Production & Transportation", occ_production),
        ]
        occ_items.sort(key=lambda x: x[1], reverse=True)
        top_occupations = []
        for name, count in occ_items[:5]:
            top_occupations.append({
                "name": name,
                "share": safe_share(count, occ_total),
            })

        # Build top industries (sorted by share, top 5)
        ind_items = sorted(industries.items(), key=lambda x: x[1], reverse=True)
        top_industries = []
        for name, count in ind_items[:5]:
            top_industries.append({
                "name": name,
                "share": safe_share(count, ind_total),
            })

        # Compute population density placeholder (will be 0 — needs precinct area)
        # We'll compute this separately after
        pop = round(population)

        profile = {
            "population": pop,
            "populationDensity": 0,  # filled in later
            "age": {
                "under18": safe_share(under18, age_total),
                "18to34": safe_share(age_18_34, age_total),
                "35to54": safe_share(age_35_54, age_total),
                "55to64": safe_share(age_55_64, age_total),
                "65plus": safe_share(age_65plus, age_total),
                "medianAge": safe_round(median_age),
            },
            "gender": {
                "male": safe_share(male, gender_total),
                "female": safe_share(female, gender_total),
            },
            "households": {
                "total": round(total_hh),
                "familyHouseholds": round(family_hh),
                "marriedCouples": round(married_couples),
                "singleParent": round(single_parent),
                "nonFamily": round(nonfamily_hh),
                "averageSize": safe_round(avg_hh_size, 2),
            },
            "income": {
                "medianHousehold": round(median_hhi) if pd.notna(median_hhi) else None,
                "brackets": {
                    "under50k": safe_share(inc_under50k, inc_total),
                    "50kTo100k": safe_share(inc_50_100, inc_total),
                    "100kTo150k": safe_share(inc_100_150, inc_total),
                    "150kTo200k": safe_share(inc_150_200, inc_total),
                    "over200k": safe_share(inc_over200, inc_total),
                },
                "povertyRate": safe_share(poverty_below, poverty_total),
            },
            "education": {
                "highSchoolOrLess": safe_share(edu_hs, edu_total),
                "someCollege": safe_share(edu_some, edu_total),
                "bachelors": safe_share(edu_bach, edu_total),
                "graduateProfessional": safe_share(edu_grad, edu_total),
            },
            "employment": {
                "laborForceParticipation": safe_share(labor_force, emp_total),
                "unemploymentRate": safe_share(unemployed, labor_force),
                "topOccupations": top_occupations,
                "topIndustries": top_industries,
            },
            "housing": {
                "ownerOccupied": safe_share(owner, tenure_total),
                "renterOccupied": safe_share(renter, tenure_total),
                "medianHomeValue": round(median_home) if pd.notna(median_home) else None,
                "medianRent": round(median_rent) if pd.notna(median_rent) else None,
            },
            "commute": {
                "droveAlone": safe_share(drove_alone, commute_total),
                "carpooled": safe_share(carpooled, commute_total),
                "publicTransit": safe_share(transit, commute_total),
                "workedFromHome": safe_share(wfh, commute_total),
                "other": safe_share(walked + other_commute, commute_total),
                "meanCommuteMinutes": safe_round(mean_commute),
            },
            "language": {
                "englishOnly": safe_share(english_only, lang_total),
                "spanish": safe_share(spanish, lang_total),
                "asianLanguages": safe_share(asian_langs, lang_total),
                "other": safe_share(lang_total - english_only - spanish - asian_langs, lang_total),
            },
            "veterans": {
                "total": round(veterans),
                "share": safe_share(veterans, vet_total_pop),
            },
            "insurance": {
                "insured": safe_share(insured, insured + uninsured) if (insured + uninsured) > 0 else None,
                "uninsured": safe_share(uninsured, insured + uninsured) if (insured + uninsured) > 0 else None,
            },
        }

        profiles[str(pct_id)] = profile

    return profiles


def compute_population_density(profiles):
    """Compute population density using precinct areas from GeoJSON."""
    logger.info("Computing population density from precinct areas...")
    precincts = gpd.read_file(PRECINCT_GEOJSON)
    precincts["PRECINCT"] = precincts["PRECINCT"].astype(int)
    precincts_proj = precincts.to_crs(epsg=EPSG_PROJECTED)

    # Area in square feet → convert to square miles
    SQ_FT_PER_SQ_MILE = 5280 * 5280

    for _, row in precincts_proj.iterrows():
        pct = str(int(row["PRECINCT"]))
        if pct in profiles:
            area_sqmi = row.geometry.area / SQ_FT_PER_SQ_MILE
            if area_sqmi > 0:
                profiles[pct]["populationDensity"] = round(
                    profiles[pct]["population"] / area_sqmi
                )

    return profiles


# ---------------------------------------------------------------------------
# Phase D: Generate 2026 boundary profiles
# ---------------------------------------------------------------------------

def fill_missing_precincts(profiles, geojson_path):
    """Fill missing precincts with county-wide averages from existing profiles."""
    gdf = gpd.read_file(geojson_path)
    all_pcts = set(str(int(x)) for x in gdf["PRECINCT"].unique())
    missing = all_pcts - set(profiles.keys())
    if not missing:
        return profiles

    logger.info(f"Filling {len(missing)} missing precincts with county averages: {sorted(missing, key=int)}")

    # Compute population-weighted county averages
    total_pop = sum(p["population"] for p in profiles.values())
    if total_pop == 0:
        return profiles

    def pw_avg(key_path):
        """Population-weighted average of a nested value."""
        total = 0
        for p in profiles.values():
            v = p
            for k in key_path:
                if isinstance(v, dict) and k in v:
                    v = v[k]
                else:
                    v = None
                    break
            if v is not None:
                total += v * p["population"]
        return total / total_pop if total_pop > 0 else 0

    def pw_count(key_path):
        """Population-weighted sum divided by number of precincts (avg count)."""
        total = 0
        for p in profiles.values():
            v = p
            for k in key_path:
                if isinstance(v, dict) and k in v:
                    v = v[k]
                else:
                    v = None
                    break
            if v is not None:
                total += v
        return round(total / len(profiles))

    # Build a county-average profile
    avg_profile = {
        "population": pw_count(["population"]),
        "populationDensity": pw_count(["populationDensity"]),
        "age": {k: round(pw_avg(["age", k]), 4) for k in ["under18", "18to34", "35to54", "55to64", "65plus"]},
        "gender": {k: round(pw_avg(["gender", k]), 4) for k in ["male", "female"]},
        "households": {
            "total": pw_count(["households", "total"]),
            "familyHouseholds": pw_count(["households", "familyHouseholds"]),
            "marriedCouples": pw_count(["households", "marriedCouples"]),
            "singleParent": pw_count(["households", "singleParent"]),
            "nonFamily": pw_count(["households", "nonFamily"]),
            "averageSize": round(pw_avg(["households", "averageSize"]), 2),
        },
        "income": {
            "medianHousehold": round(pw_avg(["income", "medianHousehold"])),
            "brackets": {k: round(pw_avg(["income", "brackets", k]), 4) for k in ["under50k", "50kTo100k", "100kTo150k", "150kTo200k", "over200k"]},
            "povertyRate": round(pw_avg(["income", "povertyRate"]), 4),
        },
        "education": {k: round(pw_avg(["education", k]), 4) for k in ["highSchoolOrLess", "someCollege", "bachelors", "graduateProfessional"]},
        "employment": {
            "laborForceParticipation": round(pw_avg(["employment", "laborForceParticipation"]), 4),
            "unemploymentRate": round(pw_avg(["employment", "unemploymentRate"]), 4),
            "topOccupations": [],
            "topIndustries": [],
        },
        "housing": {
            "ownerOccupied": round(pw_avg(["housing", "ownerOccupied"]), 4),
            "renterOccupied": round(pw_avg(["housing", "renterOccupied"]), 4),
            "medianHomeValue": round(pw_avg(["housing", "medianHomeValue"])),
            "medianRent": round(pw_avg(["housing", "medianRent"])),
        },
        "commute": {k: round(pw_avg(["commute", k]), 4) for k in ["droveAlone", "carpooled", "publicTransit", "workedFromHome", "other"]},
        "language": {k: round(pw_avg(["language", k]), 4) for k in ["englishOnly", "spanish", "asianLanguages", "other"]},
        "veterans": {
            "total": pw_count(["veterans", "total"]),
            "share": round(pw_avg(["veterans", "share"]), 4),
        },
        "insurance": {
            "insured": round(pw_avg(["insurance", "insured"]), 4),
            "uninsured": round(pw_avg(["insurance", "uninsured"]), 4),
        },
    }
    avg_profile["age"]["medianAge"] = round(pw_avg(["age", "medianAge"]), 1)
    avg_profile["commute"]["meanCommuteMinutes"] = round(pw_avg(["commute", "meanCommuteMinutes"]), 1)

    # Build avg occupations/industries from all profiles
    occ_totals = {}
    ind_totals = {}
    for p in profiles.values():
        for occ in p.get("employment", {}).get("topOccupations", []):
            occ_totals[occ["name"]] = occ_totals.get(occ["name"], 0) + occ["share"] * p["population"]
        for ind in p.get("employment", {}).get("topIndustries", []):
            ind_totals[ind["name"]] = ind_totals.get(ind["name"], 0) + ind["share"] * p["population"]
    avg_profile["employment"]["topOccupations"] = [
        {"name": n, "share": round(v / total_pop, 4)}
        for n, v in sorted(occ_totals.items(), key=lambda x: x[1], reverse=True)[:5]
    ]
    avg_profile["employment"]["topIndustries"] = [
        {"name": n, "share": round(v / total_pop, 4)}
        for n, v in sorted(ind_totals.items(), key=lambda x: x[1], reverse=True)[:5]
    ]

    for pct in missing:
        profiles[pct] = avg_profile.copy()

    return profiles


def remap_to_2026(profiles):
    """Remap profiles from 252 → 273 precincts using voter-based crosswalk."""
    if not VOTER_CROSSWALK.exists():
        logger.warning(f"Voter crosswalk not found: {VOTER_CROSSWALK}, skipping 2026 remap")
        return None

    logger.info("Remapping to 2026 precinct boundaries...")
    cw = pd.read_csv(VOTER_CROSSWALK)
    logger.info(f"  Crosswalk: {len(cw)} rows, "
                f"{cw['new_precinct'].nunique()} new precincts ← "
                f"{cw['old_precinct'].nunique()} old precincts")

    new_profiles = {}

    for new_pct in sorted(cw["new_precinct"].unique()):
        rows = cw[cw["new_precinct"] == new_pct]

        # Check if this is a simple 1:1 copy (single source with weight=1.0)
        if len(rows) == 1 and abs(rows.iloc[0]["weight"] - 1.0) < 0.001:
            old_pct = str(int(rows.iloc[0]["old_precinct"]))
            if old_pct in profiles:
                new_profiles[str(int(new_pct))] = profiles[old_pct].copy()
                continue

        # Weighted interpolation from multiple source precincts
        profile = interpolate_profile(profiles, rows)
        if profile is not None:
            new_profiles[str(int(new_pct))] = profile

    logger.info(f"  Generated {len(new_profiles)} profiles for 2026 boundaries")
    return new_profiles


def interpolate_profile(profiles, crosswalk_rows):
    """Interpolate a census profile from multiple source precincts."""
    sources = []
    total_weight = 0

    for _, row in crosswalk_rows.iterrows():
        old_pct = str(int(row["old_precinct"]))
        weight = row["weight"]
        if old_pct in profiles:
            sources.append((profiles[old_pct], weight))
            total_weight += weight

    if not sources or total_weight == 0:
        return None

    # Normalize weights
    norm_sources = [(p, w / total_weight) for p, w in sources]

    # Weighted interpolation
    def wavg(key_path, is_count=False):
        """Get weighted average (or weighted sum for counts) of a nested value."""
        vals = []
        for p, w in norm_sources:
            v = p
            for k in key_path:
                if isinstance(v, dict) and k in v:
                    v = v[k]
                else:
                    v = None
                    break
            if v is not None and not (isinstance(v, float) and np.isnan(v)):
                vals.append((v, w))

        if not vals:
            return None

        if is_count:
            return sum(v * w * total_weight for v, w in vals)
        else:
            return sum(v * w for v, w in vals)

    # Population and count fields: scale by weight * total_weight (area-proportional)
    population = wavg(["population"], is_count=True)
    if population is None or population <= 0:
        return None

    pop_density = wavg(["populationDensity"], is_count=False)  # avg density

    # Weighted-average occupation/industry lists
    def wavg_ranked(key_path):
        """Weighted average of ranked lists."""
        combined = {}
        for p, w in norm_sources:
            v = p
            for k in key_path:
                if isinstance(v, dict) and k in v:
                    v = v[k]
                elif isinstance(v, dict):
                    v = None
                    break
                else:
                    v = None
                    break
            if v and isinstance(v, list):
                for item in v:
                    name = item.get("name", "")
                    share = item.get("share", 0)
                    if name:
                        combined[name] = combined.get(name, 0) + share * w

        items = sorted(combined.items(), key=lambda x: x[1], reverse=True)
        return [{"name": n, "share": round(s, 4)} for n, s in items[:5]]

    profile = {
        "population": round(population),
        "populationDensity": round(pop_density) if pop_density else 0,
        "age": {
            "under18": round(wavg(["age", "under18"]) or 0, 4),
            "18to34": round(wavg(["age", "18to34"]) or 0, 4),
            "35to54": round(wavg(["age", "35to54"]) or 0, 4),
            "55to64": round(wavg(["age", "55to64"]) or 0, 4),
            "65plus": round(wavg(["age", "65plus"]) or 0, 4),
            "medianAge": round(wavg(["age", "medianAge"]) or 0, 1),
        },
        "gender": {
            "male": round(wavg(["gender", "male"]) or 0, 4),
            "female": round(wavg(["gender", "female"]) or 0, 4),
        },
        "households": {
            "total": round(wavg(["households", "total"], is_count=True) or 0),
            "familyHouseholds": round(wavg(["households", "familyHouseholds"], is_count=True) or 0),
            "marriedCouples": round(wavg(["households", "marriedCouples"], is_count=True) or 0),
            "singleParent": round(wavg(["households", "singleParent"], is_count=True) or 0),
            "nonFamily": round(wavg(["households", "nonFamily"], is_count=True) or 0),
            "averageSize": round(wavg(["households", "averageSize"]) or 0, 2),
        },
        "income": {
            "medianHousehold": round(wavg(["income", "medianHousehold"]) or 0),
            "brackets": {
                "under50k": round(wavg(["income", "brackets", "under50k"]) or 0, 4),
                "50kTo100k": round(wavg(["income", "brackets", "50kTo100k"]) or 0, 4),
                "100kTo150k": round(wavg(["income", "brackets", "100kTo150k"]) or 0, 4),
                "150kTo200k": round(wavg(["income", "brackets", "150kTo200k"]) or 0, 4),
                "over200k": round(wavg(["income", "brackets", "over200k"]) or 0, 4),
            },
            "povertyRate": round(wavg(["income", "povertyRate"]) or 0, 4),
        },
        "education": {
            "highSchoolOrLess": round(wavg(["education", "highSchoolOrLess"]) or 0, 4),
            "someCollege": round(wavg(["education", "someCollege"]) or 0, 4),
            "bachelors": round(wavg(["education", "bachelors"]) or 0, 4),
            "graduateProfessional": round(wavg(["education", "graduateProfessional"]) or 0, 4),
        },
        "employment": {
            "laborForceParticipation": round(wavg(["employment", "laborForceParticipation"]) or 0, 4),
            "unemploymentRate": round(wavg(["employment", "unemploymentRate"]) or 0, 4),
            "topOccupations": wavg_ranked(["employment", "topOccupations"]),
            "topIndustries": wavg_ranked(["employment", "topIndustries"]),
        },
        "housing": {
            "ownerOccupied": round(wavg(["housing", "ownerOccupied"]) or 0, 4),
            "renterOccupied": round(wavg(["housing", "renterOccupied"]) or 0, 4),
            "medianHomeValue": round(wavg(["housing", "medianHomeValue"]) or 0),
            "medianRent": round(wavg(["housing", "medianRent"]) or 0),
        },
        "commute": {
            "droveAlone": round(wavg(["commute", "droveAlone"]) or 0, 4),
            "carpooled": round(wavg(["commute", "carpooled"]) or 0, 4),
            "publicTransit": round(wavg(["commute", "publicTransit"]) or 0, 4),
            "workedFromHome": round(wavg(["commute", "workedFromHome"]) or 0, 4),
            "other": round(wavg(["commute", "other"]) or 0, 4),
            "meanCommuteMinutes": round(wavg(["commute", "meanCommuteMinutes"]) or 0, 1),
        },
        "language": {
            "englishOnly": round(wavg(["language", "englishOnly"]) or 0, 4),
            "spanish": round(wavg(["language", "spanish"]) or 0, 4),
            "asianLanguages": round(wavg(["language", "asianLanguages"]) or 0, 4),
            "other": round(wavg(["language", "other"]) or 0, 4),
        },
        "veterans": {
            "total": round(wavg(["veterans", "total"], is_count=True) or 0),
            "share": round(wavg(["veterans", "share"]) or 0, 4),
        },
        "insurance": {
            "insured": round(wavg(["insurance", "insured"]) or 0, 4),
            "uninsured": round(wavg(["insurance", "uninsured"]) or 0, 4),
        },
    }

    return profile


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fetch ACS census data for precinct profiles")
    parser.add_argument("--skip-download", action="store_true",
                        help="Reuse cached TIGER shapefile")
    parser.add_argument("--crosswalk-only", action="store_true",
                        help="Only build the spatial crosswalk, skip ACS fetch")
    args = parser.parse_args()

    # Phase A: Build crosswalk
    if CROSSWALK_OUT.exists() and args.skip_download:
        logger.info(f"Loading cached crosswalk from {CROSSWALK_OUT}")
        crosswalk = pd.read_csv(CROSSWALK_OUT, dtype={"bg_geoid": str})
    else:
        crosswalk = build_precinct_bg_crosswalk(skip_download=args.skip_download)

    if args.crosswalk_only:
        logger.info("Crosswalk-only mode, done.")
        return

    # Phase B: Fetch ACS data
    bg_data = fetch_all_acs_data()

    # Phase C: Aggregate to precincts
    profiles = aggregate_to_precincts(bg_data, crosswalk)

    # Compute population density
    profiles = compute_population_density(profiles)

    # Fill missing precincts with county averages
    profiles = fill_missing_precincts(profiles, PRECINCT_GEOJSON)

    # Write original boundary profiles
    with open(OUTPUT_PATH, "w") as f:
        json.dump(profiles, f, indent=2)
    logger.info(f"Wrote {len(profiles)} profiles to {OUTPUT_PATH}")
    logger.info(f"  File size: {OUTPUT_PATH.stat().st_size / 1024:.1f} KB")

    # Phase D: Generate 2026 boundary profiles
    NEW_GEOJSON = DATA_DIR / "Voting_Precincts_2026.geojson"
    profiles_2026 = remap_to_2026(profiles)
    if profiles_2026:
        profiles_2026 = fill_missing_precincts(profiles_2026, NEW_GEOJSON)
        OUTPUT_2026.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_2026, "w") as f:
            json.dump(profiles_2026, f, indent=2)
        logger.info(f"Wrote {len(profiles_2026)} profiles to {OUTPUT_2026}")

    # Summary stats
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    pops = [p["population"] for p in profiles.values()]
    incomes = [p["income"]["medianHousehold"] for p in profiles.values() if p["income"]["medianHousehold"]]
    homes = [p["housing"]["medianHomeValue"] for p in profiles.values() if p["housing"]["medianHomeValue"]]
    print(f"Precincts:   {len(profiles)}")
    print(f"Population:  min={min(pops):,}, max={max(pops):,}, "
          f"mean={sum(pops)/len(pops):,.0f}, total={sum(pops):,}")
    if incomes:
        print(f"Median HHI:  min=${min(incomes):,}, max=${max(incomes):,}, "
              f"mean=${sum(incomes)/len(incomes):,.0f}")
    if homes:
        print(f"Home value:  min=${min(homes):,}, max=${max(homes):,}, "
              f"mean=${sum(homes)/len(homes):,.0f}")

    # Spot checks
    print()
    for pct in ["245", "1", "100"]:
        if pct in profiles:
            p = profiles[pct]
            print(f"Precinct {pct}: pop={p['population']:,}, "
                  f"medHHI=${p['income']['medianHousehold']:,}, "
                  f"medHome=${p['housing']['medianHomeValue']:,}, "
                  f"owner={p['housing']['ownerOccupied']:.1%}, "
                  f"renter={p['housing']['renterOccupied']:.1%}")


if __name__ == "__main__":
    main()
