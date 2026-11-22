# Isha Yoga Center · 3D Virtual Tour

Explore a procedural Three.js model of the Isha Yoga Center near Coimbatore, India. The tour includes landmark flyovers, first-person walking and flight, lighting presets, and a roof cutaway view.

[Open the tour on GitHub Pages](https://sadhgurum.github.io/isha-tour/) once the first deployment succeeds.

## Languages

Use the globe menu beside the controls to change the language without restarting the tour. The menu shows the active language code and lists all 72 Bhasha choices by their native names. Filipino and Tagalog share translations, as do Norwegian and Norwegian Bokmål.

Share the URL to open the tour in the selected language, for example `?lang=ta` for Tamil. The English selection clears the language parameter. Links without a language parameter use the visitor's saved choice or preferred browser language, with English as the fallback.

Translations are bundled with the tour as static files. Most locales contain machine-translated text. Some use shorter landmark descriptions than the English and Simplified Chinese versions. Signs rendered inside the 3D model retain their original wording.

## Tour controls

| Mode             | Controls                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview         | Drag to orbit, scroll or pinch to zoom, and right-drag or Shift-drag to pan. Select a landmark in the navigation list to fly to it.                                                                                                                 |
| Walking (`漫步`) | Walk starts beneath the camera or at a nearby spot with footing and room to stand. Use WASD, the arrow keys, or the touch joystick to move. Keep moving to build speed, hold Shift to sprint, drag to look, or press Esc to return to the overview. |
| Flight           | Double-tap Space or press F to toggle flight. Hold Space or E to ascend and Shift, Q, or C to descend. On touchscreens, press Flight to take off, hold ↑ or ↓ to change altitude, and double-tap ↓ to land.                                         |
| Cutaway (`剖视`) | Toggle roofs to view modeled interiors.                                                                                                                                                                                                             |

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

In **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source. Then push to `main` or run **Check and deploy tour** manually from `main`.

Pull requests run formatting, linting, TypeScript and translation coverage checks, and the production build. On `main`, the workflow commits the generated site to `gh-pages` and deploys the same build through GitHub Pages. The branch is managed by CI. Publishing through the Pages action lets the workflow use the built-in token. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Credits and license

The original tour modeling and code are credited to Claude (Anthropic). The model uses OpenStreetMap coordinates and was built with reference to the Isha campus map and publicly available photos.

The repository is licensed under the [MIT License](LICENSE).
