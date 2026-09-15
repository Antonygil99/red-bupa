# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev          # astro dev on 127.0.0.1
npm run build        # static build into dist/
npm run preview      # serve dist/
npm run data:import  # regenerate src/data/directory.json from Yucatán/
npm run icons:build  # regenerate src/components/IconSprite.astro from iconsax-astro
npm test             # node --test tests/*.test.mjs
node --test tests/directory.test.mjs --test-name-pattern 'timezone'  # single test
```

`npm test` reads the committed `src/data/directory.json`, so run `data:import` before testing when the source lists in `Yucatán/` change.

Copy `.env.example` to `.env` before working on the map. Everything is `PUBLIC_*` because the site is static and the values end up in the client bundle; without a token the app falls back to CARTO tiles and straight-line "routes".

## Architecture

Static Astro site (`output: 'static'`), no backend, no accounts, no booking. Deployed as the `dist/` folder (see `.openai/hosting.json`). The product is called **myhealth**; the npm package is `myhealth-merida`.

Data flows one direction:

1. `Yucatán/*.txt` — untouched source exports (JSON arrays with Spanish keys, `\u`-escaped, possible BOM), one file per directory category, plus `lista-municipios.txt` and `aviso-cobertura.txt` (the fallback-phone notice shown in the help dialog). Never edit these.
2. [scripts/import-data.mjs](scripts/import-data.mjs) — walks the `SOURCES` table, maps Spanish keys to English fields, tags each provider with a `category` slug, folds the seven `horariO_*` columns into a `schedule` array indexed Monday–Sunday, and derives `specialties` from the profiles because `lista-especialidades.txt` is empty. Coordinates outside the Mérida bounding box are set to `coordinates: null` while the raw pair is kept in `originalCoordinates` with a `coordinateIssue` message, so those profiles are deliberately absent from the map and radius search. `idProveedor` is not unique — pharmacy chains reuse one id across every branch — so repeats get a numeric suffix (`F1003678-2`); do not assume `id` equals the source id. Empty source files are skipped and reported, so a category with no data never appears in the UI. A provider gets a `photo` only when `public/fotos/<idProveedor>.png` exists; there is no placeholder portrait, the list falls back to initials. Add a category by adding a row to `SOURCES`, an icon to `ICONS` in the sprite script, and a `.cat-<id>` color in the stylesheet.
3. `src/data/directory.json` — generated, committed, imported directly by the client bundle. Carries `notice`, `categories` (id/label/count), `municipalities`, `specialties` and `providers`.

Four source files hold everything else:

- [src/lib/directory.mjs](src/lib/directory.mjs) — pure helpers shared by the app and the tests: `CENTER`, `AREA` (the Mérida bounding box), `normalize` (accent-insensitive), `distance` (haversine, km), `inArea`, `scheduledNow` (evaluates a `HH:MM-HH:MM Y HH:MM-HH:MM` split-shift string against `America/Merida` via `Intl`). `.mjs` so `node --test` can import it without a build step.
- [src/scripts/app.ts](src/scripts/app.ts) — the whole client. Module-level mutable state (`query`, `category`, `radiusIndex`, `onlyScheduled`, `collapsed`, `userPosition`, `selected`) plus `matching()` → `render()`; every interaction mutates state and calls `render()`, which re-renders the list, the markers, the legend and the map count. Leaflet map and GSAP animations are created once in `initMap()`. SVG icons are `<use href="#i-…">` references to the generated sprite.
- [src/components/IconSprite.astro](src/components/IconSprite.astro) — **generated**, do not hand-edit. [scripts/build-icons.mjs](scripts/build-icons.mjs) maps sprite ids (`i-pin`, `i-route`, `i-hospital`, …) to Iconsax names, keeps the `linear` variant and strips its inline `stroke-width` so CSS controls thickness. Category ids double as icon ids.
- [src/styles/global.css](src/styles/global.css) — single stylesheet, no framework, dense one-line rules with breakpoints at 760/1100/1500px. `.app-shell` owns `--sidebar`, the one place the sidebar width (and its collapsed 84px rail) is defined; the floating search overlay positions itself from it. Dark-blue sidebar (`--dark`) with green accents (`--green`); each category sets `--cat`/`--cat-ink` on a `.cat-<id>` class that colors avatars, chips, pins and legend dots together.

At the end of `app.ts` there is an optional WebMCP surface: if `document.modelContext.registerTool` exists it registers `search_providers` and `show_provider`, which drive the same state as the UI. It is capability-detected and must stay optional.

**Leaflet and the global `svg` rule**: the icon rule is written `svg:not(.leaflet-zoom-animated)` on purpose. Leaflet draws vector layers (route polyline, radius circle) into its own `<svg>`, and the unscoped 22×22 sizing silently clipped them to nothing. Keep any new global `svg` styling out of Leaflet's container.

## Layout

The search field and the category chips live in `.search-overlay`, a sibling of the sidebar and the map inside `.app-shell` — not inside `.map-panel`. That is deliberate: on mobile the map panel is `visibility:hidden` in list view, and a fixed child of a hidden ancestor is hidden too, so the overlay would vanish from the list. It floats over the map on desktop and pins to the top of the screen on mobile.

The detail card sits over the bottom-left of the map, so any framing that must stay visible goes through `mapPadding()`, which measures the card and returns Leaflet padding that clears it. Use it for `fitBounds` (route) and `panInside` (selected pin) rather than a bare `panTo`, otherwise the destination lands behind the card.

## Persistence

Two `localStorage` keys, both written through `readStore`/`writeStore`, which swallow errors so private mode never breaks the app:

- `myhealth:prefs` — category, radius step, schedule filter, sidebar collapsed. Validated on read against the current data before use.
- `myhealth:position` — the last authorized coordinates plus a timestamp, reused for 12 h so the user is not re-prompted every visit, and discarded if stale or outside `AREA`. On load, `navigator.permissions.query` refreshes it silently only when permission is already granted, so no dialog appears.

## Constraints that the code deliberately enforces

These are product commitments, not incidental behavior — tests in [tests/directory.test.mjs](tests/directory.test.mjs) assert them.

- Never invent data. No fabricated coordinates, prices, photos, reviews, ratings or availability. Missing values render as "Sin horario registrado" / "Ubicación por verificar", and a category with an empty source file simply does not exist in the UI.
- Activity comes from the source files and is not generalized in either direction: the detail note differs for the one `active` profile, and no inactive profile may have `bookingEnabled`. There is no online scheduling and copy must not imply one.
- The visitor's coordinates stay on the device — `localStorage` only, never sent anywhere. Geolocation is requested on an explicit button press (or silently when already granted), and all five failure modes (denied, unavailable, timeout, unsupported browser, insecure context) plus "outside coverage" have handled messages.
- Distances in the list are straight-line, always labeled as such. Routing is separate: "Cómo llegar" calls the Mapbox Directions API and draws the result on the map (`drawRoute`). It never leaves the app — there is no Google Maps hand-off. Without a token, or when the request fails, it draws a dashed straight line and says so rather than passing a fake trajectory off as a route.
- `AREA` is an operational rectangle, not an official municipal polygon — an exact check would need official GeoJSON.
- The list stays usable when tiles fail: map errors surface `#map-message` rather than blocking profiles.
- Animations are gated on `prefers-reduced-motion`; all interactive elements keep keyboard access and toasts are announced via `aria-live`.

UI copy is Spanish (`es-MX`); code identifiers are English.
