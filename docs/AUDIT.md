# TowerIQ: Forensic Audit of the Baseline (Phase 1)

Audit date: 2026-11-17. Baseline commit: `6e007a9` (imported from
`~/Documents/smart_tower-platform/tower-platform`, last modified 2026-07-09).

## 0. Which code was audited

The ZIP in `~/Documents/My Projects/smart_tower-platform.zip` holds **only
the frontend, docs and hardware simulation** (36 files). It has **no backend**,
even though the README and all docs describe one. The complete project
(backend included) was found at `~/Documents/smart_tower-platform/tower-platform`.
It is identical to `~/Downloads/tower-platform-main` apart from `.vscode/`, and
it is the newest copy on disk. That complete copy is the baseline. The original
ZIP and every original folder are left untouched.

## 1. Challenge alignment

The official brief (`~/INFRATEL-UNZA-iHub-Hackathon-2026.pdf`) has four tracks.
This system targets **Challenge 1: Smart Tower Monitoring & Infrastructure
Intelligence Platform**, and it does so honestly. Its feature list mirrors
the brief's capability list item for item (infrastructure, power, fuel &
generator, security, environmental, commercial, reporting). The track
assignment is not forced.

Weakness: it *mirrors* the checklist and does nothing past it. Every
Challenge 1 team will build a dashboard covering the same bullets. The baseline
has no answer to "why this one?"

## 2. Architecture assessment

| Layer | Baseline | Verdict |
|---|---|---|
| Runtime | Node 22.5+, zero npm dependencies, single process | **Keep.** Starts with one command and needs no venue internet: a real demo advantage. |
| MQTT | Hand-rolled 3.1.1 broker + client, QoS 0, no auth | Works (verified). Fine for demo; production needs auth/TLS (documented). |
| WebSocket | Hand-rolled RFC 6455 hub | Works. **No authentication**: anyone can read the stream or inject events. |
| DB | SQLite (`node:sqlite`), sensible normalised schema, indexes on hot paths | Good base. No asset model (tank size, burn rate, battery, solar), so no physics-based reasoning was possible. |
| HTTP | Small Express-like router | Works. No body-size limit, malformed JSON silently becomes `{}`, no security headers. |
| Frontend | Vanilla JS SPA, canvas charts | Simple and loads fast. Data-contract drift against the backend (see defects). |
| Tests | 20 `node:test` tests (engine + API) | **All 20 pass** (run 2026-11-17). Coverage stops at the basics. |

## 3. Verified defects (found by running the system, not by reading names)

### Critical
1. **Privilege escalation:** `POST /api/auth/register` is unauthenticated and
   honours `role: "admin"`. Verified live: an anonymous request received an
   admin token.
2. **Executive dashboard shows no sites.** The backend returns
   `siteIntelligence[]`, while `dashboard.js` reads `sites`/`siteRisks`. The site
   grid always renders "No sites configured yet". Uptime and fuel read
   non-existent flat keys and render `n/a`.
3. **Hardcoded revenue fallback**: `normalizeFleetSummary` falls back to
   `33300` when revenue is missing, so the UI could show a number that came from no data.
4. **Stored XSS**: alert messages, site names and the anomaly feed are inserted
   with `innerHTML` unescaped. Alert text includes device-supplied fields
   (e.g. `details.drop_liters` from MQTT), so a device or anyone on the
   unauthenticated WebSocket can inject script into the operator console.
5. **Unauthenticated event injection**: any WebSocket client can send
   `camera-event` for any site and raise critical intrusion alarms.

### High
6. **CSV export buttons always 401.** They are plain `<a href>` links, and the
   API requires a Bearer header.
7. **API origin hardcoded** to `http://localhost:3000`, so the UI breaks on any
   other port or host and on a phone via LAN or tunnel.
8. **Power-switch log is wrong.** The "previous source" query returns any
   historical row from a different source, so after a site's first switch,
   every tick logs a false switch event.
9. **GET requests write to the DB.** `GET /reports/predictive-maintenance`,
   `/ai/fleet-summary` and `/ai/anomalies` insert a `maintenance_flags` row on
   every call, and `GET /reports/sla` inserts breach rows and alerts. Data
   grows on every refresh, and reports are not idempotent.
10. **No role enforcement anywhere.** The `viewer`/`operator`/`admin` roles exist
    in the schema but are never checked.
11. **Fresh database = empty story.** With no history, uptime is a trivial
    100%, utilisation is 100% grid, predictive engines need 14 days of data and
    never fire, and the first injected theft occurs ~33 min after boot. A judge
    sees a quiet dashboard.

### Medium
12. Theft detection works in **percent**, not litres or Kwacha, and only catches
    a ≥15% drop in 10 min. Slow siphoning (the common real pattern) is invisible.
13. The landing page claims **"End-to-End Encrypted"**. The system serves plain
    HTTP and unencrypted WS/MQTT. **This is a false claim.**
14. Rule-based thresholds and a linear regression are labelled "AI FILTER" /
    "AI anomalies". This invites a judge to call it AI-washing.
15. Duplicate site id → raw SQLite 500. Tenant deletion returns ok for
    non-existent rows. Login has no throttling.
16. `computeUptimePct` loads a site's entire status history on every call.

## 4. Inventory: what is genuinely good (preserve)

- One telemetry contract (MQTT topics) for simulator, Wokwi firmware and future
  hardware. Honest, documented hardware-simulation boundary.
- A single alert pipeline (rule → row → broadcast → ack/resolve) with real
  MTTA/MTTR computed from timestamps.
- SLA uptime reconstructed from status transitions, not stored as a number.
- Phone-camera CCTV node with on-device frame differencing: a real,
  low-bandwidth edge pattern.
- scrypt password hashing, opaque expiring sessions, timing-safe compare.
- Zero-dependency single-command start.

## 5. What is missing entirely

- Any notion of **energy autonomy**: battery, solar capacity, tank litres,
  generator burn rate. Without it the system cannot answer the question an
  operator under load-shedding actually asks: *which towers go dark next, and
  when?*
- Money: no SLA-penalty, diesel-cost or revenue-at-risk model, so "reduce
  operational losses" (a stated desired impact) cannot be measured.
- Fuel **reconciliation** (deliveries vs. modelled burn vs. measured level).
- A repeatable demo path (scenario triggers) and realistic historical data.

## 6. Major risks

| Risk | Mitigation adopted |
|---|---|
| Judges see "yet another dashboard" | One signature capability tied to Zambia's load-shedding and ZICTA's 2025 redundancy directive (see STRATEGY.md) |
| Live demo depends on venue Wi-Fi | Keep zero-dependency, single-process, offline-capable design |
| Over-claiming AI or data | Every model is explainable and named by what it does; all demo data is labelled simulated in the UI and API |
| Security questions from judges | Fix all critical/high defects above; document remaining prototype limits |
