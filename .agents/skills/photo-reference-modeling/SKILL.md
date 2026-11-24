---
name: photo-reference-modeling
description: Refine a real building, shrine, gate, monument, or site feature in a 3D model using user photos and online visual references. Use for architectural form, facade and roof details, materials, entrances, and interiors.
---

# Model architectural detail from photos

1. Identify the exact place and part the user wants refined. Check aliases, spelling variants, and nearby lookalikes. Inspect the existing model's footprint, orientation, camera presets, and structural elements before changing its details.
2. Start with relevant user photos and firsthand corrections. Search for official site photos, dated event coverage, or other attributable imagery for missing angles. Find a front or three-quarter view and a side, rear, aerial, or interior view when the requested geometry needs depth. Check landmarks, orientation, and dates so different buildings or construction phases stay distinct.
3. Make a short inventory of what the references support. Use aerial or mapped outlines for footprint and orientation. Use ground photos for window proportions, wall and roof treatment, openings, and details visible at eye level. Use interior images for layout and circulation. Check proportions against repeated elements such as doorways, bays, or steps. Estimate dimensions only as far as the evidence supports, and record the estimate.
4. Build the silhouette, roofline, symmetry, and entrances first. Then add the recognizable details at the scale they will be seen. Reuse the project's geometry and materials. Keep entrances, stairs, and circulation usable. Leave hidden or conflicting features simplified, and attribute reference photos and any user-supplied assumptions separately. Use photos as reference unless a requested asset reuse is licensed or authorized.
5. Compare the revised model from the reference angles and from the normal visitor view. Check front and side alignment, door and stair clearance, and any interior or cutaway mode affected by the edit. Inspect the resulting preview when available. Report the details verified from references and any remaining estimates.

## Isha Tour

Find the landmark in `COMPONENTS` in `src/tour.js` and inspect its factory, camera presets, visitor clearance, and roof cutaway behavior. Factories normally model the building front along local +Z, while the component sets its world position and rotation. Keep detail in the existing factory unless a separate view or component serves the request. For site placement, roads, or land cover, use `map-cross-check`.
