# Frontend

Vanilla JavaScript single-page application — **no build step, no
framework, no bundler**. Served as static files directly by the backend
(`backend/src/server.js`); just open the backend's URL in a browser.

## Why no React/Vite

The build environment used to create this project had no internet access
for `npm install`, so a Vite/React toolchain couldn't be installed or
verified. Rather than deliver an unbuildable, untested frontend, this was
built on plain browser APIs (`fetch`, `WebSocket`, `Canvas`, hash-based
routing) and verified serving correctly from a live backend instance. See
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#why-zero-dependencies)
for the React migration path — the API/WebSocket contracts this frontend
consumes don't change if you migrate.

## Structure

| Path | Purpose |
|---|---|
| `index.html` | Single entry point; loads all scripts in dependency order |
| `css/styles.css` | Design system (CSS custom properties, dark theme, grid layout) |
| `js/api.js` | `fetch` wrapper handling auth token + JSON |
| `js/ws.js` | WebSocket client with auto-reconnect, simple pub/sub for pages to subscribe to live events |
| `js/charts.js` | Zero-dependency canvas line/bar chart renderer |
| `js/app.js` | Hash-based router + sidebar shell |
| `js/pages/*.js` | One module per page: login, dashboard, site detail, alerts, tenancy, reports |

## Routing

Client-side hash routing (`#/`, `#/site/:id`, `#/alerts`, `#/tenancy`,
`#/reports`, `#/login`) — no server-side route handling needed for page
navigation, only for the initial static file load.

## Live updates

Every page that shows live data calls `Live.on(callback)` in
`js/ws.js` to subscribe to WebSocket events, and returns an unsubscribe
function that's called via a `hashchange` listener when the user
navigates away — preventing stale listeners from accumulating as you
move between pages.
