# unsure/ — quarantine for files of uncertain value

Moved here during the June 11, 2026 repo cleanup instead of deleting outright.
If nothing has needed a file here after a few months, delete it (everything is
also recoverable from git history regardless).

| File | What it is | Why it's here, not deleted |
|------|-----------|---------------------------|
| `audit_website.js` | One-off Playwright script that cross-checks displayed numbers against the CSVs (slider math, manifest coverage) | The data-validation logic could seed a future automated data-integrity test |
| `fix_manifest.py` | One-off: scans `data/` and adds missing CSVs to `elections.json` | Superseded by `data_processor/manifest_generator.py`, but useful if the manifest ever drifts from the files again |
| `improve_manifest_years.py` | One-off: infers missing `year` fields in the manifest from filenames | Same as above — manifest repair tooling |
| `test-animations.html` | Manual QA page for CSS animation/reduced-motion checks | Self-contained; might be wanted for visual QA of future animation work |
| `test-print-styles.html` | Manual QA page for print stylesheets | Self-contained; print styles still exist in styles.css |

Deleted outright in the same cleanup (recover from git history if ever needed):
18 leftover comma/en-dash-named CSVs from an early scrape (sanitized duplicates
are the canonical ones in the manifests), `.cursor/plans/` editor planning docs,
six point-in-time status reports in `docs/` (AUDIT_*, FIXES_*, QA_REVIEW,
SCHEMA_IMPLEMENTATION_SUMMARY — all describing January 2026 work long merged),
`scripts/ui_probe.js` + `ui_walkthrough.js` (superseded by the e2e suite), and
`tests/test_ui_functionality.html` (its module import path was broken — it
imported `./js/dataLoader.js` relative to `tests/`, which doesn't exist).
