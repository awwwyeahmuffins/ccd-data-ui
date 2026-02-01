# Collin County Election Data Viewer

An interactive web application for exploring Collin County, Texas election data with demographic analysis, turnout visualization, and election forecasting.

## Features

- **Demographics View**: Explore precinct-level demographic data with party lean visualization
- **Election Forecast**: Browse 211+ elections across Federal, State, County, City, ISD, and MUD races
- **Turnout Analysis**: Analyze voter turnout patterns by precinct with leaderboards
- **Interactive Map**: Click precincts to view detailed breakdowns
- **Search & Filter**: Find elections by name, category, or year
- **Command Palette**: Quick navigation with `Cmd+K` / `Ctrl+K`
- **Deep Linking**: Share specific elections via URL
- **Mobile Responsive**: Full functionality on all device sizes

## Quick Start

```bash
# Install dependencies
make install

# Start server and open browser
make start

# Or manually:
python3 -m http.server 3000
# Then open http://localhost:3000/index-new.html
```

## Available Commands

Use `make help` to see all available commands:

### Server Commands
```bash
make serve       # Start development server on port 3000
make start       # Kill port 3000 processes and start server
make stop        # Stop any process running on port 3000
```

### Testing Commands
```bash
make test        # Run all tests (unit + e2e)
make test-unit   # Run unit tests with Jest
make test-e2e    # Run Playwright e2e tests
make test-headed # Run Playwright tests with browser visible
make test-debug  # Run Playwright tests in debug mode
make test-mobile # Run mobile-specific tests
```

### Code Quality
```bash
make lint        # Run linter checks
make format      # Format code
make clean       # Clean generated files and caches
```

## Project Structure

```
├── index.html          # Main application entry point
├── styles.css          # Application styles
├── js/                 # JavaScript modules
│   ├── app.js          # Main application controller
│   ├── dataLoader.js   # Data fetching and caching
│   ├── demographicsView.js
│   ├── electionView.js
│   ├── turnoutView.js
│   └── ...             # Other modules
├── data/               # Election and demographic data
│   ├── elections.json  # Election manifest
│   ├── *.csv           # Individual election results
│   ├── Voting_Precincts.geojson
│   ├── DNC Score By Precinct.csv
│   └── Racial Numbers by Precinct.csv
├── data_processor/     # Data processing scripts
│   ├── unified_parser.py
│   ├── manifest_generator.py
│   └── ...
├── docs/               # Documentation
│   ├── DATA_LAYOUT_SPEC.md
│   ├── AUDIT_SUMMARY.md
│   └── ...
├── scripts/            # Utility scripts
└── tests/              # Test files
```

## Data

The application uses:
- **405 election CSV files** covering 2022 and 2024 elections
- **GeoJSON precinct boundaries** for map visualization
- **Demographic data** including party affiliation and racial demographics

## Development

### Running Tests

```bash
# Run all tests
make test

# Run only unit tests
make test-unit

# Run Playwright e2e tests
make test-e2e

# Run Playwright tests with browser visible
make test-headed

# Run tests in debug mode
make test-debug

# View test report
make report
```

### Processing New Election Data

```bash
cd data_processor
python unified_parser.py input.csv
python manifest_generator.py
```

### Troubleshooting

**Port 3000 already in use:**
```bash
make stop    # Kill process on port 3000
make start   # Start server fresh
```

**Playwright tests failing:**
```bash
npx playwright install    # Reinstall browsers
make test-headed          # Run with visible browser to debug
```

**Clear all caches:**
```bash
make clean
make install
```

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES Modules)
- **Mapping**: Leaflet.js
- **Charts**: Chart.js
- **Data Processing**: D3.js
- **Styling**: Custom CSS with CSS Variables

## License

This project is for educational and civic engagement purposes.
