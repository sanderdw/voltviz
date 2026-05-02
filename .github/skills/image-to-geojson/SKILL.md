---
name: image-to-geojson
description: 'Extract labeled features from map images into GeoJSON FeatureCollections with real-world coordinates. Use when digitizing infrastructure maps, converting station/substation diagrams to GeoJSON, extracting labeled points from screenshots, or creating spatial datasets from visual sources.'
argument-hint: '[image attachment or description of map to digitize]'
---

# Image-to-GeoJSON Extraction

## What This Skill Produces
- A valid GeoJSON `FeatureCollection` file with `Point` features.
- Each feature has real-world WGS84 coordinates (`[longitude, latitude]`).
- Properties extracted from labels (name, type/category, location/town).

## When To Use
- Digitize labeled points from a map image (e.g. substations, infrastructure).
- Convert a visual station/infrastructure diagram into machine-readable GeoJSON.
- Create or update a `src/data/*.json` or similar spatial data files.

## Inputs
- An image attachment showing a map with labeled features.
- Optional: category prefixes to extract (e.g. RS, OS, SS).
- Optional: target region or bounding box for coordinate estimation.

## Procedure

### 1. Analyze the Image
- Identify the geographic region shown (province, country, bounding box).
- Identify label prefixes or categories (e.g. RS = Regelstation, OS = Onderstation, SS = Schakelstation).
- Note the approximate coordinate bounds of the map extent.

### 2. Extract All Labeled Features
- Systematically scan the image region by region (top-to-bottom, left-to-right).
- Record every labeled feature with its:
  - Full name (including prefix).
  - Category/type from the prefix.
  - Nearest town or city for the `location` property.

### 3. Assign Coordinates
- Map each feature's visual position to approximate WGS84 coordinates.
- Use known city/town locations as anchor points for accuracy.
- For clustered features, offset coordinates slightly to avoid overlap.

### 4. Generate GeoJSON
- Output a valid GeoJSON `FeatureCollection`.
- Each feature follows this structure:

```json
{
  "type": "Feature",
  "id": 1,
  "geometry": {
    "type": "Point",
    "coordinates": [longitude, latitude]
  },
  "properties": {
    "name": "RS Example",
    "type": "RS",
    "location": "Town Name"
  }
}
```

### 5. Validate
- Coordinates use GeoJSON order: `[longitude, latitude]`.
- All features fall within the expected geographic bounds.
- No duplicate features; clustered stations have distinct coordinates.
- JSON is valid and parseable.

## Quality Gates
- Every visible labeled feature in the image is captured.
- Coordinates are geographically plausible (within region bounds).
- GeoJSON validates against the GeoJSON specification (RFC 7946).
- Properties include at minimum: `name`, `type`, `location`.

## Completion Checklist
- All labeled features extracted from image.
- Coordinates assigned based on real-world geography.
- Output is a valid GeoJSON FeatureCollection.
- File written to the correct data path.
- Feature count reported to user for verification.
