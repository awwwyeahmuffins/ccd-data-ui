# Security Audit Report

**Date:** February 5, 2026
**Project:** Collin County Election Data Viewer
**Context:** Application plans to store PII (names, addresses, voting records, primary voter ID numbers)

---

## Executive Summary

The application has **7 critical**, **6 high**, and **5 medium** risk findings. It was built as a public data visualization tool and lacks the security infrastructure required for PII. **Do not store PII in this app in its current form.**

---

## CRITICAL Findings

### 1. No HTTPS/TLS Encryption
- **Location:** `Makefile:48` — `python3 -m http.server 3000`
- **Risk:** All data transmitted in plaintext. Names, addresses, voter IDs would be readable in network traffic via eavesdropping or MITM attacks.

### 2. No Authentication or Authorization
- **Risk:** Zero login, session management, API keys, or access control. Anyone with network access can download all data:
  ```bash
  curl http://localhost:3000/data/*.csv
  curl http://localhost:3000/data/elections.json
  curl http://localhost:3000/data/Voting_Precincts.geojson
  ```

### 3. Python `http.server` Exposes Entire Directory
- **Risk:** Every file in the project is served — including `.git/`, `node_modules/`, all CSVs, GeoJSON, and source code. Python's `http.server` docs explicitly warn: *"is not recommended for production. It only implements basic security checks."*

### 4. `.git/` Directory Accessible via HTTP
- **Risk:** Commit history, developer info, and any previously-committed secrets are downloadable. An attacker can reconstruct the full repository.

### 5. XSS Vulnerabilities — CSV Data Rendered via `innerHTML`
- **Location:** `js/electionView.js:1098-1100`
  ```js
  winnerHTML = `<strong>Original Winner:</strong> ${originalWinner}`;
  ```
- **Risk:** Candidate names from CSV are injected directly into HTML. A malicious CSV value like `<img src=x onerror=alert(document.cookie)>` would execute JavaScript. **40+ `innerHTML` assignments** across the codebase follow this unsafe pattern.

### 6. No Content Security Policy or Security Headers
- **Risk:** No CSP, no `X-Frame-Options`, no `X-Content-Type-Options`, no HSTS. No XSS mitigation, no clickjacking protection, no MIME sniffing defense.

### 7. Development Server Used as Production Server
- **Location:** `Makefile`
- **Risk:** Python's `http.server` has no TLS support, no auth, no access control, no rate limiting, no logging suitable for production.

---

## HIGH Findings

### 8. External CDN Scripts Loaded Without SRI Hashes
- **Location:** `index.html:1359-1362`
  ```html
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.3.1/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>
  ```
- **Risk:** No `integrity=` attributes. A compromised CDN could serve malicious code that exfiltrates all loaded PII to an attacker-controlled server.

### 9. Election Data Cached in JS Memory
- **Location:** `js/dataLoader.js:20-25`
- **Risk:** `dataCache` object holds all 330 precincts' data in memory, inspectable from browser DevTools console by any user.

### 10. URL Hash Exposes Selected Election and Precinct
- **Location:** `js/urlStateManager.js`
- **Risk:** URL like `#view=election&race=Governor_2024.csv&precinct=123` is visible in browser history, server logs, and shared links.

### 11. Export Functionality Outputs Unencrypted Full Precinct Data
- **Location:** `js/exportManager.js:28-62`
- **Risk:** CSV export includes registered voters, ballots cast, vote counts by candidate — downloadable by anyone without restriction.

### 12. No CORS Restrictions
- **Risk:** Any website can fetch this app's data if network-accessible. No `Access-Control-Allow-Origin` headers configured.

### 13. Outdated D3.js (v7) Loaded from CDN
- **Risk:** D3.js v7 is from ~2021 and likely contains known vulnerabilities. No version pinning with integrity verification.

---

## MEDIUM Findings

### 14. `localStorage` Stores Browsing History Unencrypted
- **Keys:** `ccd_recently_viewed`, `ccd_bookmarks`, `ccd_theme`
- **Risk:** Viewable in plaintext if device is compromised. Reveals which elections a user viewed.

### 15. Console Error Logging Could Leak Data
- **Locations:** `js/analytics.js`, `js/recentlyViewed.js`, `js/bookmarkManager.js`
- **Risk:** Error handlers may log election data values to browser console.

### 16. Search Input Not Sanitized Before Highlight Rendering
- **Location:** `js/racePickerPanel.js:474`
- **Risk:** Search query used in `highlightMatches()` and fed to `innerHTML`.

### 17. No Rate Limiting
- **Risk:** Unlimited requests allowed. Bulk data scraping and enumeration are trivial.

### 18. `node_modules/` Served Over HTTP
- **Risk:** Attackers can enumerate exact dependency versions to find known CVEs.

---

## Affected Files Summary

| File | Issue |
|------|-------|
| `Makefile` | Development server, no HTTPS |
| `index.html` | CDN scripts without SRI, no security headers |
| `js/dataLoader.js` | Unauthenticated fetch calls, in-memory caching |
| `js/electionView.js` | innerHTML XSS (40+ instances across codebase) |
| `js/urlStateManager.js` | State exposed in URL hash |
| `js/exportManager.js` | Unrestricted data export |
| `js/racePickerPanel.js` | Unsanitized search input rendering |
| `js/recentlyViewed.js` | Unencrypted localStorage |
| `js/bookmarkManager.js` | Unencrypted localStorage |
| `js/analytics.js` | Console logging of event data |
| `data_processor/collin_harvest.py` | Web scraper (low risk) |

---

## Required Remediation Before PII

### P0 — Must Fix Before Any PII Deployment

| Action | Effort | Details |
|--------|--------|---------|
| Replace `http.server` with production server | Medium | Use nginx or Express behind HTTPS with SSL cert (Let's Encrypt) |
| Add authentication | High | Session-based or token-based auth with login UI |
| Restrict served paths | Low | Block `.git/`, `node_modules/`; require auth for `/data/` |
| Fix innerHTML XSS | Medium | Replace all `innerHTML` with `textContent` or DOM APIs for data-sourced content |
| Add CSP header | Medium | `default-src 'self'; script-src 'self'` (requires self-hosting libraries) |

### P1 — High Priority

| Action | Effort | Details |
|--------|--------|---------|
| Add SRI hashes to CDN scripts | Low | Generate `integrity=` attributes for all `<script>` and `<link>` tags |
| Encrypt data at rest | Medium | Encrypt PII CSVs on disk, decrypt server-side for authenticated users only |
| Add audit logging | Medium | Log all data access with timestamps and user identity |
| Add security headers | Low | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS |
| Add CORS restrictions | Low | Whitelist only the app's own origin |

### P2 — Recommended

| Action | Effort | Details |
|--------|--------|---------|
| Self-host JS libraries | Low | Vendor D3, Leaflet, Chart.js instead of loading from CDNs |
| Implement rate limiting | Low | Limit requests per IP per time window |
| Clear localStorage on logout | Low | Add expiry and cleanup for stored browsing data |
| Update D3.js to latest | Low | Upgrade from v7 to current version |
| Run `npm audit` regularly | Low | Add to CI pipeline |

---

## Regulatory Considerations

Voter ID numbers and primary voting records are protected under:

- **Texas Election Code** — Voting records confidentiality
- **Texas Government Code Section 552** — Public information law
- **CCPA** (if California residents are involved) — Consumer privacy rights

Storing PII in a client-side web app that sends raw data to the browser means **every user's device becomes a data breach vector**. Consider:

- Keeping PII server-side only
- Sending only aggregated/anonymized data to the frontend
- Consulting an election law attorney before handling voter-level data

---

## Architecture Recommendation

For PII handling, the app needs a fundamentally different architecture:

```
Current (UNSAFE for PII):
  Browser  <--HTTP plaintext-->  python http.server  -->  raw CSV files on disk

Required:
  Browser  <--HTTPS/TLS-->  nginx reverse proxy  -->  Express/Flask API server
                                                        |
                                                        +--> Auth middleware
                                                        +--> Rate limiter
                                                        +--> Audit logger
                                                        +--> Encrypted data store
                                                        +--> Return only aggregated data
```

---

**Bottom line:** This app is well-built for its original purpose — public election data visualization. But it was never designed for PII. Adding names, addresses, and voter IDs requires a production web server, authentication, encryption at rest and in transit, and server-side data processing that never exposes raw PII to the browser.
