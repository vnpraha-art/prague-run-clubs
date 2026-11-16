# Prague Run Clubs

Installable web app (PWA) that shows Prague's run clubs on a map: who runs today, a week view, filters, and add-to-calendar.

Plain static files, no build step. Vercel deploys the repository as it is.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell |
| `app.css` | Styles, light and dark themes |
| `app.js` | All app logic |
| `sw.js` | Service worker: offline support and caching |
| `manifest.webmanifest`, `*.png` | Install metadata and icons |
| `clubs-snapshot.json` | Copy of the club list shown on a first visit until live data arrives, and when the data endpoint is unreachable |
| `fonts/` | Archivo variable font (latin and latin-ext), self-hosted |
| `vendor/` | MapLibre GL JS 5.24.1 (map library) |

## Data

Club data comes from the Google Sheet `prague_run_clubs` through the Apps Script endpoint in `SCRIPT_URL` (`app.js`). One row is one session. The app expects these fields and nothing else:

`id, name, category, days, time, timeFilter, distFilter, distText, pace, meet, lat, lng, free, desc, link`

The app keeps the last downloaded list on the device (`localStorage`, key `prc_clubs_v1`), shows it immediately on the next open, and then replaces it with live data.

## Map

Vector tiles, label fonts and the tile index come from [OpenFreeMap](https://openfreemap.org) (free, no API key). The map colours are defined in `mapStyle()` in `app.js`. The forecast comes from [Open-Meteo](https://open-meteo.com) and is optional.

## When you change things

- Changing `sw.js`, or adding a file the app needs offline: bump `VERSION` in `sw.js` and add the file to `SHELL`.
- `index.html`, `app.css` and `app.js` are fetched network-first, so a deploy shows up on the next open without a version bump.
- To refresh `clubs-snapshot.json`: save the endpoint's JSON as `{"savedAt": <ms timestamp>, "clubs": [...]}`.

## Run locally

```
python3 -m http.server 4173
```

Then open http://localhost:4173.
