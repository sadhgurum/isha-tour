# Isha Yoga Center · 3D Virtual Tour

[![Check and deploy tour](https://github.com/sadhgurum/isha-tour/actions/workflows/pages.yml/badge.svg?branch=main&event=push)](https://github.com/sadhgurum/isha-tour/actions/workflows/pages.yml)

Explore a procedural Three.js model of the Isha Yoga Center near Coimbatore, India. The tour includes landmark flyovers, first-person walking and flight, lighting presets, and a roof cutaway view.

[Open the tour on GitHub Pages](https://sadhgurum.github.io/isha-tour/).

## Languages

Use the globe menu beside the controls to change the language without restarting the tour. Options are alphabetized by their English names and also show the native names where they differ. The globe control shows the active language code.

Share the URL to open the tour in the selected language, for example `?lang=ta` for Tamil. The English selection clears the language parameter. Links without a supported language parameter use the visitor's saved choice or preferred browser language, with English as the fallback.

Translations are bundled with the tour as static files. Most locales contain machine-translated text, and some use shorter landmark descriptions. The Russian and Ukrainian versions follow the Isha translation teams' style guides. Signs rendered inside the 3D model retain their original wording.

The tour bundles Isha Tour Hand for headings. It extends the original Custom Hand lettering with Cyrillic glyphs and Latin accents. To regenerate the WOFF2, install Python's `fonttools` and `brotli` packages, then run `python3 scripts/build-title-font.py ../fonts/output/CustomHand-Regular.ttf` with the original font file.

## Tour controls

| Mode             | Controls                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview         | Drag to orbit and scroll or pinch to zoom. Pan with right-drag, Shift-drag, or a three-finger drag on a touchscreen. Select a landmark in the navigation list to fly to it.                                                                         |
| Walking (`漫步`) | Walk starts beneath the camera or at a nearby spot with footing and room to stand. Use WASD, the arrow keys, or the touch joystick to move. Keep moving to build speed, hold Shift to sprint, drag to look, or press Esc to return to the overview. |
| Flight           | Double-tap Space or press F to toggle flight. Hold Space or E to ascend and Shift, Q, or C to descend. On touchscreens, press Flight to take off, hold ↑ or ↓ to change altitude, and double-tap ↓ to land.                                         |
| Cutaway (`剖视`) | Toggle roofs to view modeled interiors.                                                                                                                                                                                                             |

On a touchpad with tap-and-drag enabled, tap once over the overview, then hold the second tap and drag to pan. With a mouse, click once, then hold the second click and drag.

## Local development

Use Node.js 24 as specified in [.nvmrc](.nvmrc). The tour runs in a modern browser with WebGL enabled.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Save your edits, then refresh the browser to load the latest JavaScript and TypeScript. Vite transpiles TypeScript as the browser requests it. The page stays open until you refresh it.

Use `npm run format` to apply Prettier, `npm run typecheck` to check TypeScript, and `npm run check` to run all checks and build the production site. Preview the production build with `npm run preview` after building.

- [index.html](index.html) contains the page and tour controls markup.
- [src/tour.js](src/tour.js) generates the scene and implements navigation and rendering. Edit the `COMPONENTS` registry to adjust landmarks and their camera presets.
- [src/camera-controls.ts](src/camera-controls.ts) implements the orbit camera, first-person walking, and flight.
- [src/style.css](src/style.css) styles the tour interface.

## GitHub Pages

In **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source. In **Settings → Environments → github-pages**, allow `main` to deploy if the environment uses selected branch rules. Then push to `main` or run **Check and deploy tour** manually from `main`.

Pull requests run formatting, linting, TypeScript and translation coverage checks, and the production build. On `main`, the workflow publishes the generated `dist/` files directly to GitHub Pages after the checks pass. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Credits and license

The original tour modeling and code are credited to Claude (Anthropic). The model uses OpenStreetMap coordinates and was built with reference to the Isha campus map and publicly available photos.

The repository is licensed under the [MIT License](LICENSE).
