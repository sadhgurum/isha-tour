---
name: map-cross-check
description: Verify and update a modeled site map against satellite imagery, mapped features, and route classifications. Use for campus layout, roads versus pedestrian paths, buildings in context, waterways, land cover, and site boundaries.
---

# Cross-check a site map

1. Establish the site boundary and coordinate frame before comparing features. Read the project's map coverage instructions. Align north-up imagery with the model using two or more recognizable landmarks. Check scale, axis signs, and offsets before transferring outlines to model coordinates.
2. Pick sources by what they establish.
   - Satellite imagery shows visible roofs, vegetation, field boundaries, surfaces, and route geometry. Record capture date when available and retain uncertainty beneath canopy, shadows, and roof overhangs.
   - OpenStreetMap provides geometry and feature tags. Check the relevant way or relation and its access tags before distinguishing a footway, shared route, service road, or track. Treat an edit timestamp as the date of the map edit.
   - An official site map or firsthand reference can clarify local names, boundaries, and intended routes. Signed access and recent site evidence take priority over a classification inferred from road width.
   - When a requested map layer is inaccessible, identify the substitute actually inspected. Use user-provided screenshots or another accessible source where useful. Keep the requested-source comparison pending if it could materially affect the answer.
3. Compare one area at a time. Use a north-up overlay or coordinate grid where alignment is hard to judge. Record the observed feature, proposed correction, source, and any inference. Use separate footprints for visibly distinct groves, cultivation, lawns, buildings, and yards. Estimate heights or obscured outlines only as far as the evidence supports.
4. Verify connections wherever the edit meets existing geometry. Follow both ends of roads, paths, and waterways. Model an open-water crossing only at an evidenced bridge or crossing, and preserve clear ramps and approaches. Resolve overlapping road materials to one visible surface at junctions. Keep pedestrian and vehicle behavior tied to route classification rather than list order.
5. Check the result from above for alignment and at walking height for clearances. For route edits, sample for gaps, stacked surfaces, and accidental water crossings. Run the project's checks and state which findings were verified visually, checked in geometry, or remain approximate.

## Isha Tour

Use the campus coverage rule in `AGENTS.md`. In `src/tour.js`, map positions use metres east and north of Dhyanalinga and `geo()` converts them to scene coordinates. Update the route, land-cover, or building data that owns the feature. When changing a stream crossing, check both the rendered deck and first-person footing. For architectural details from ground-level photos, use `photo-reference-modeling`.
