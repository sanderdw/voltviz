# Liander Infrastructure Map — GeoJSON Extraction Report

## Background

Liander is one of the largest electricity grid operators in the Netherlands. As part of their
investment planning through 2035, they publish regional infrastructure maps showing the
locations of substations and switching stations across their service area.

These maps were provided as image attachments and a multi-page PDF. The goal was to
digitize every labeled station into machine-readable GeoJSON files for use in the VoltViz
visualizer project.

## Source Material

https://www.liander.nl/over-ons/financiele-publicaties/investeringsplannen

| Source | Region | Format | Pages |
|--------|--------|--------|-------|
| Liander investment map | Amsterdam | Image (PNG) | 1 |
| Liander investment map | Flevoland | Image (PNG) | 1 |
| Liander investment map | Friesland | Image (PNG) | 1 |
| Liander investment map | Noord-Holland | PDF | 9 |
| Liander investment map | Gelderland | Image (PNG) | 1 (pre-existing) |
| Liander investment map | Zuid-Holland | Image/PDF | 1 |

## Station Types

The maps use three standard prefixes to categorize infrastructure:

| Prefix | Dutch Name | English | Voltage Level |
|--------|-----------|---------|---------------|
| **OS** | Onderstation | Substation | 50–380 kV (TenneT + Liander) |
| **RS** | Regelstation | Control station | 20–10 kV (Liander) |
| **SS** | Schakelstation | Switching station | 10–20 kV (Liander) |

## Extraction Process

### Method

1. **Image analysis** — Each map image was visually scanned region-by-region
   (top-to-bottom, left-to-right) to identify all labeled features.
2. **Coordinate assignment** — Each feature's visual position was mapped to approximate
   WGS84 coordinates using known city/town locations as anchor points.
3. **GeoJSON generation** — Features were written as a `FeatureCollection` with `Point`
   geometries following RFC 7946.
4. **Validation** — Automated checks verified JSON validity, coordinate bounds,
   unique IDs, unique names, and required properties.
5. **Model** — Opus 4.6.


### Coordinate Estimation Technique

Since the source maps are not georeferenced raster images, coordinates were estimated by:

- Identifying known landmarks (cities, towns) visible on the map
- Using their real-world coordinates as anchor points
- Interpolating positions for stations based on their visual location relative to anchors
- Applying small offsets for clustered stations to ensure distinct coordinates

**Accuracy:** Coordinates are approximate (estimated ±0.5–2 km). They are suitable for
visualization at city/regional zoom levels but should not be used for navigation or
precise infrastructure planning.

## Results Summary

### Per-File Statistics

| File | Features | OS | RS | SS | Lon Range | Lat Range |
|------|----------|----|----|----|-----------|---------  |
| `gelderland.json` | 115 | 71 | 32 | 12 | 5.153 – 6.720 | 51.776 – 52.478 |
| `amsterdam.json` | 51 | 44 | 2 | 5 | 4.770 – 5.020 | 52.302 – 52.412 |
| `flevoland.json` | 33 | 14 | 14 | 5 | 5.120 – 5.835 | 52.395 – 52.843 |
| `friesland.json` | 62 | 27 | 19 | 16 | 5.070 – 6.291 | 52.845 – 53.480 |
| `noord-holland.json` | 106 | 88 | 13 | 5 | 4.533 – 5.290 | 52.218 – 53.140 |
| `zuid-holland.json` | 32 | 30 | 1 | 1 | 4.395 – 4.769 | 52.030 – 52.292 |
| **Total** | **399** | **274** | **81** | **44** | | |

### Aggregate Breakdown

- **274 Onderstations (OS)** — 68.7% of all features
- **81 Regelstations (RS)** — 20.3% of all features
- **44 Schakelstations (SS)** — 11.0% of all features

### Geographic Coverage

The combined dataset spans:
- **Longitude:** 4.395°E (Zuid-Holland coast) to 6.720°E (eastern Gelderland)
- **Latitude:** 51.776°N (southern Gelderland) to 53.480°N (Ameland, Friesland)

This covers the full Liander service area across 6 provinces.

## GeoJSON Schema

Each feature follows this structure:

```json
{
  "type": "Feature",
  "id": 1,
  "geometry": {
    "type": "Point",
    "coordinates": [longitude, latitude]
  },
  "properties": {
    "name": "OS Example",
    "type": "OS",
    "location": "Town Name"
  }
}
```

**Properties:**
- `name` — Full station name including prefix (e.g. "OS Diemen")
- `type` — Category prefix: `OS`, `RS`, or `SS`
- `location` — Nearest town or city name

## Findings & Observations

### 1. Station Density Varies Significantly by Region

Amsterdam has 51 stations in a very small geographic area (~10×10 km), while Friesland
has 62 stations spread across an entire province. Urban areas require far more substations
per square kilometer due to higher electricity demand density.

### 2. OS Dominates the Infrastructure Mix

Onderstations make up nearly 69% of all mapped stations. This reflects their role as the
primary voltage transformation points in the distribution network. RS and SS stations
serve more specialized roles in regulation and switching.

### 3. Regional Type Distribution Differs

- **Flevoland** has an unusually even OS/RS split (14/14), likely because the province was
  built from scratch (polders) with a more planned grid layout.
- **Zuid-Holland** is almost entirely OS (30 of 32), suggesting the extract focused on
  the main substation infrastructure.
- **Friesland** has the highest proportion of SS stations (16 of 62 = 26%), reflecting
  a more distributed switching network across its rural landscape.

### 4. Clustered Infrastructure Around Key Nodes

Several areas show high station clustering:
- **Amsterdam Zuidas** — 4 stations (SS Zuidas Noord, SS Zuidas Zuid I & II, SS NACH, SS ROPT)
- **Schiphol area** — 5 stations within a few km
- **Heerenveen** — 4 stations (OS Heerenveen, OS Heerenveen KNO, SS Hermes, SS Pim Mulier)
- **Hoorn** — 4 stations (OS Hoorn Noord, OS Hoorn Parkweg, OS Hoorn Holenweg, OS Zuiderkogge)

These clusters correspond to areas of high economic activity or major grid interconnection points.

### 5. Noord-Holland PDF Required Multi-Page Extraction

The Noord-Holland source was a 9-page PDF with regional detail maps. Cross-referencing the
overview page (page 1) with the detail pages (pages 2–9) was necessary to capture all 106
stations and avoid duplicates. Some stations appeared on multiple detail pages at region
boundaries.

### 6. Naming Conventions

- Station names typically follow the pattern: `{prefix} {location/street name}`
- Some stations include Roman numerals for phased installations: "OS Hemweg I & II"
- A few use directional suffixes: "OS Drachten Zuid", "OS Weesp Noord"
- Some reference infrastructure: "OS Schiphol Centrum", "SS Schiphol-Rijk"

## Limitations

1. **Coordinate precision** — Positions are visual estimates, not surveyed coordinates.
   Expect ±0.5–2 km accuracy.
2. **Completeness** — Only labeled stations visible in the source images were captured.
   Unlabeled or obscured stations may be missing.
3. **Temporal accuracy** — Maps show planned infrastructure through 2035. Some stations
   may not yet exist or may have been renamed/relocated.
4. **Boundary overlap** — Stations near provincial borders (e.g. OS Diemen, OS Lemmer)
   may appear in multiple regional files. The amsterdam.json and noord-holland.json files
   have some geographic overlap by design.

## Validation Checks Performed

For each file, the following automated validations were run:

- [x] Valid JSON (parseable)
- [x] Valid GeoJSON `FeatureCollection` structure
- [x] All geometries are `Point` type
- [x] Coordinates in `[longitude, latitude]` order
- [x] All coordinates within expected provincial bounds
- [x] No duplicate feature IDs
- [x] No duplicate feature names
- [x] All features have required properties: `name`, `type`, `location`

## File Locations

All GeoJSON files are stored in `src/data/`:

```
src/data/
├── amsterdam.json          (51 features)
├── flevoland.json          (33 features)
├── friesland.json          (62 features)
├── gelderland.json         (115 features)
├── noord-holland.json      (106 features)
└── zuid-holland.json       (32 features)
```
