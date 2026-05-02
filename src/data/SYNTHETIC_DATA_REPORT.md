# Synthetic GeoJSON Data — Creation Report

## Purpose

This report documents the creation of synthetic (fabricated) GeoJSON data for 7 Dutch
provinces where no official Liander infrastructure maps were available. The synthetic
data complements the 6 real datasets extracted from Liander investment maps, enabling
full national coverage for visualization and development purposes.

## Why Synthetic Data?

The real extraction datasets cover the **Liander service area** — the provinces of
Gelderland, Flevoland, Friesland, Noord-Holland, Zuid-Holland, and the municipality
of Amsterdam. However, the remaining 6 provinces are served by other grid operators:

| Province | Grid Operator | Data Source |
|----------|--------------|-------------|
| Groningen | Enexis | Synthetic |
| Drenthe | Enexis | Synthetic |
| Overijssel | Enexis | Synthetic |
| Utrecht | Stedin | Synthetic |
| Zeeland | Stedin / Enduris | Synthetic |
| Noord-Brabant | Enexis | Synthetic |
| Limburg | Enexis | Synthetic |

Since equivalent map sources from these operators were not available, synthetic data
was generated to fill the geographic gaps for development and demonstration purposes.

## How the Synthetic Data Was Created

### Identification Strategy

Each synthetic file was designed to be immediately recognizable as non-real data:

1. **Filename prefix** — All files use `synthetic-` prefix (e.g. `synthetic-groningen.json`)
2. **Metadata flag** — Each file includes a top-level `"synthetic": true` property
3. **Separation from real data** — No mixing of synthetic features into real data files

### Coordinate Generation Method

Coordinates were assigned using real-world geography:

1. **Real town/city locations** — Each station is placed at or near a real Dutch municipality
2. **Provincial boundaries** — All coordinates verified to fall within correct provincial bounds
3. **Urban clustering** — Major cities (Eindhoven, Maastricht, etc.) receive multiple stations
   to reflect realistic urban density patterns
4. **Spacing** — Clustered stations are offset by 0.01–0.02 degrees (~1–2 km) to avoid overlap

### Station Naming Convention

Names follow the same pattern as the real Liander data:

- `{TYPE} {City/Town}` — e.g. "OS Maastricht"
- `{TYPE} {City} {Direction}` — e.g. "RS Venlo Noord"
- `{TYPE} {Landmark}` — e.g. "OS High Tech Campus"

### Type Distribution

The real data averages roughly:
- **OS (Onderstation):** ~69% of features
- **RS (Regelstation):** ~20% of features
- **SS (Schakelstation):** ~11% of features

Synthetic data was created with similar proportions to maintain consistency.

## Dataset Comparison

### Real Data (from Liander maps)

| File | Features | OS | RS | SS | Lon Range | Lat Range |
|------|----------|----|----|-----|-----------|-----------|
| `gelderland.json` | 115 | 71 | 32 | 12 | 5.153 – 6.720 | 51.776 – 52.478 |
| `amsterdam.json` | 51 | 44 | 2 | 5 | 4.770 – 5.020 | 52.302 – 52.412 |
| `flevoland.json` | 33 | 14 | 14 | 5 | 5.120 – 5.835 | 52.395 – 52.843 |
| `friesland.json` | 62 | 27 | 19 | 16 | 5.070 – 6.291 | 52.845 – 53.480 |
| `noord-holland.json` | 106 | 88 | 13 | 5 | 4.533 – 5.290 | 52.218 – 53.140 |
| `zuid-holland.json` | 32 | 30 | 1 | 1 | 4.395 – 4.769 | 52.030 – 52.292 |
| **Subtotal** | **399** | **274** | **81** | **44** | | |

### Synthetic Data (generated)

| File | Features | OS | RS | SS | Lon Range | Lat Range |
|------|----------|----|----|-----|-----------|-----------|
| `synthetic-groningen.json` | 28 | 16 | 9 | 3 | 6.280 – 7.088 | 53.055 – 53.365 |
| `synthetic-drenthe.json` | 23 | 12 | 8 | 3 | 6.195 – 7.048 | 52.695 – 53.058 |
| `synthetic-overijssel.json` | 30 | 18 | 9 | 3 | 5.912 – 6.948 | 52.178 – 52.602 |
| `synthetic-utrecht.json` | 25 | 15 | 7 | 3 | 5.008 – 5.555 | 52.002 – 52.170 |
| `synthetic-zeeland.json` | 20 | 12 | 7 | 1 | 3.440 – 4.172 | 51.310 – 51.750 |
| `synthetic-noord-brabant.json` | 35 | 22 | 10 | 3 | 4.290 – 5.945 | 51.355 – 51.768 |
| `synthetic-limburg.json` | 28 | 17 | 8 | 3 | 5.618 – 6.182 | 50.752 – 51.455 |
| **Subtotal** | **189** | **112** | **58** | **19** | | |

### Combined Totals

| Metric | Real | Synthetic | Combined |
|--------|------|-----------|----------|
| **Files** | 6 | 7 | 13 |
| **Features** | 399 | 189 | 588 |
| **OS** | 274 (68.7%) | 112 (59.3%) | 386 (65.6%) |
| **RS** | 81 (20.3%) | 58 (30.7%) | 139 (23.6%) |
| **SS** | 44 (11.0%) | 19 (10.1%) | 63 (10.7%) |
| **Provinces** | 6 | 7 | 12 + Amsterdam |

## What Makes This Data "Synthetic"

### What IS realistic
- **Town names** — All towns and cities exist in the real Netherlands
- **Coordinates** — Points are placed at geographically correct locations for those towns
- **Provincial bounds** — All features fall within the correct province
- **Type prefixes** — OS, RS, SS follow the Dutch grid operator naming convention
- **Density patterns** — Larger cities get more stations

### What is NOT realistic
- **Station existence** — There is no guarantee these specific stations actually exist
- **Station names** — Names like "OS Eindhoven Noord" are plausible but invented
- **Exact locations** — Stations are placed at approximate city centers, not at real
  substation sites
- **Station counts** — The number of stations per province does not reflect actual
  infrastructure density
- **Type assignments** — Whether a location has an OS vs RS vs SS is arbitrary
- **Grid operator** — These provinces are not served by Liander; real station naming
  conventions may differ (Enexis uses different terminology)

## Validation Performed

Each synthetic file passed the same automated checks as the real data:

- [x] Valid JSON structure
- [x] Valid GeoJSON `FeatureCollection` with `Point` geometries
- [x] `"synthetic": true` flag present
- [x] All coordinates within provincial bounds
- [x] No duplicate feature IDs
- [x] No duplicate feature names
- [x] All features have `name`, `type`, `location` properties
- [x] Coordinates in correct `[longitude, latitude]` order

## Usage Guidelines

### For development and visualization
Synthetic data is suitable for:
- Testing map rendering across the full Netherlands
- UI/UX development that needs national coverage
- Demonstrating visualizer capabilities at conferences or in documentation

### NOT suitable for
- Infrastructure planning or analysis
- Regulatory reporting
- Any context where accuracy of station locations matters
- Comparisons between grid operator regions

### Programmatic detection
To filter synthetic data in code:

```typescript
// Check the top-level synthetic flag
const data = JSON.parse(fileContents);
if (data.synthetic) {
  console.log('This is synthetic data');
}

// Or check the filename
if (filename.startsWith('synthetic-')) {
  console.log('This is synthetic data');
}
```

## File Locations

```
src/data/
├── amsterdam.json                  (51 features, real)
├── flevoland.json                  (33 features, real)
├── friesland.json                  (62 features, real)
├── gelderland.json                 (115 features, real)
├── noord-holland.json              (106 features, real)
├── zuid-holland.json               (32 features, real)
├── synthetic-drenthe.json          (23 features, synthetic)
├── synthetic-groningen.json        (28 features, synthetic)
├── synthetic-limburg.json          (28 features, synthetic)
├── synthetic-noord-brabant.json    (35 features, synthetic)
├── synthetic-overijssel.json       (30 features, synthetic)
├── synthetic-utrecht.json          (25 features, synthetic)
└── synthetic-zeeland.json          (20 features, synthetic)
```
