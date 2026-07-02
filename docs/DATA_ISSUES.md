# Data Issues Audit

Catalog of data-source conflicts and reliability problems found in the precinct
data layer (Collin), with severity, location, and recommended action. Counts are
for Collin's two boundary sets (2024 = 252 precincts, 2026 = 273 precincts).

This audit was prompted by the map (`js/commandCenter.js`) and the precinct report
(`js/precinctLookup.js`) disagreeing on a precinct's "Population".

---

## 1. Population universe conflict — **High → resolved**

Three different per-precinct "size" numbers exist, measuring different universes:

| Field | Source | What it really is | PCT 221 (2024) |
|---|---|---|---|
| `population` | `census_profiles.json` | ACS total population (area-weighted apportionment) | 7,222 |
| `total` | `racial.csv` | Racial-model voter universe (≈ registered voters) | 5,284 |
| `Total` | `dnc_scores.csv` | DNC-scored voter subset | 4,954 |

The map showed `racial.total` (5,284); the report showed `census.population` (7,222)
under the same "Population" label.

**Resolution:** "Population" is now standardized sitewide to `racial.total` via the
shared helper `populationOf(racial)` in `js/utils.js`. Updated display sites:
`precinctLookup.js` (hero card, `computeCountyAverages` average + ranking, compare
view), `fieldOnePager.js` (HTML badge + text), `precinctExport.js` (markdown summary),
`precinctProfile.js` (Census Profile "Pop." line). The map already used `racial.total`,
so the two views now always agree. Precincts with no racial row show **N/A**.

---

## 2. `census.population` is an unreliable apportionment — **Medium → flagged**

The census figures are area-weighted from ACS block groups onto precinct polygons,
which is unreliable where precinct boundaries cut across census geography:

- **Scored voters exceed census population** in **20 / 252** precincts (2024) and
  **25 / 273** (2026) — impossible for a true population (e.g. PCT 150: 5,252 scored
  vs 1,765 census pop).
- **Artifact slivers**: census assigns population to non-residential precincts with
  near-zero actual voters — **7 / 252** (2024), **3 / 273** (2026) have a census/racial
  ratio > 5× (max 112× at PCT 202: census 225 vs racial total 2).

This weakness still affects the **other** census-derived hero stats that remain on
census: median income, median age, home value, college %, and `populationDensity`.

**Action taken:** the precinct report now flags these precincts. `isCensusUnreliable()`
in `precinctLookup.js` detects `scoredVoters > census.population`; when true, both the
hero section and the census section show a "Census mismatch" warning that the
census-derived figures (income, age, home value, college, density) are unreliable
for that precinct. Figures are kept visible (not suppressed) but clearly marked.
Fully non-residential artifacts are still suppressed via `isArtifact`.

**Still open:** the underlying apportionment is not re-derived, and the
`precinct_metadata.json` `dataQuality`/`interpolationType` flags are still only used
for the "new in 2026" notice, not surfaced per-stat.

---

## 3. "Scored Voters" vs "Registered Voters" shown side by side — **Low → fixed**

The hero shows two voter-count cards from different universes:
- **Scored Voters** = `dnc_scores.csv` `Rep+Mod+Dem` (DNC-modeled subset).
- **Registered Voters** = race CSV `REGISTERED VOTERS TOTAL` (official, injected from
  the most recent race that reports it).

These legitimately differ but were easy to conflate. **Fixed:** each hero card now
carries a sublabel — "DNC-modeled subset" and "Official county count" respectively —
via the new `sublabel` arg on `heroStatCard` (`precinctLookup.js`).

---

## 4. County averages sample only precincts that have the source — **Low**

`computeCountyAverages` (`precinctLookup.js`) averages over whatever precincts have
the relevant field. With 1–4 precincts missing a racial total and some missing census
fields, a "county average / rank" is over a subset, not all 252/273. **Recommended:**
note the denominator, or impute.

---

## 5. Registered-voters total varies by race — **Low**

The same precinct can report different `REGISTERED VOTERS TOTAL` across races
(county-wide vs district races, different election dates). The hero's "Registered
Voters" picks the most recent race that reports the field. **Recommended:** document
this selection rule in the UI tooltip.

---

## 6. Boundary vintage — **Informational**

The same precinct *number* is a different polygon in the 2024 (252) vs 2026 (273)
sets, so votes/population differ for "PCT 221" between sets. Already handled: the map
defaults to 2026 and swaps to 2024 when an election is selected; the report has an
explicit 2024/2026 toggle. Listed here so the number differences aren't mistaken for
a data bug.
