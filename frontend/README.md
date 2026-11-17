# TowerIQ console

Vanilla JavaScript single-page app with no framework, bundler or build step.
It is served by the backend from the same origin, so there is no API URL to
configure.

| Path | Purpose |
|---|---|
| `index.html` | Entry point; loads scripts in order (CSP-compatible: no inline script or handlers) |
| `css/app.css` | Design tokens (dark NOC theme + light theme), layout, components, responsive rules |
| `js/core.js` | Escaping tagged templates (`h`), formatting, API client (Bearer, authenticated downloads), live WebSocket feed, router and shell, toasts |
| `js/charts.js` | Theme-aware SVG charts: survival curve, supply timeline, bars, stacked bars |
| `js/pages/*.js` | Command Center, Sites, Site, Alarms, Resilience Planner, Fuel Integrity, Commercial, Reports, Settings & Demo, Login |

Conventions: every dynamic value goes through `h```, which escapes unless
wrapped in `raw()`. Pages register teardown with `App.onLeave`, and drop stale
async results with `App.stale(rid)`. Role-gated controls use `Api.can(role)`;
the server enforces roles regardless.
