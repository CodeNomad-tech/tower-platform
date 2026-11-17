# TowerIQ: Product Strategy (Phase 2) and Roadmap (Phase 3)

## 1. The problem, precisely

Zambian towers lose power because the grid is unreliable, not because the
towers are faulty. In 2024 ZESCO load-shedding went from 8 h/day (March) to
12 h/day (May) to 17 h/day (September), with reports of up to 21 h at the
worst point ([Lusaka Times](https://www.lusakatimes.com/2024/03/08/zesco-announces-8-hour-daily-load-shedding-starting-march-11-2024/),
[Diggers](https://diggers.news/local/2024/08/17/govt-announces-17-hour-load-shedding-moves-to-hike-tariffs/),
[Wikipedia: 2024 Zambian drought](https://en.wikipedia.org/wiki/2024_Zambian_drought)).
A tower then survives only as long as its battery, solar and diesel last.

In November 2025 ZICTA gave **Infratel and IHS 21 days to submit a detailed,
time-bound action plan outlining redundancy measures for all communication
towers**, citing dropped calls and poor connectivity, and calling for backup
and solar/hybrid power ([TechAfrica News](https://techafricanews.com/2025/11/04/zambia-issues-21-day-ultimatum-to-telecom-operators-over-poor-network-quality/)).
Infratel operates **1,282 towers** and sells tower space, backup power and
remote site monitoring to MNOs and ISPs ([Infratel profile](https://infratel.co.zm/company-profile/)).

So the NOC's real questions are:
1. **Tonight:** which towers will go dark during the next outage block, and
   what must I send where, before when?
2. **This quarter:** with a limited budget, which towers should get batteries
   or solar first, and how do I prove to ZICTA that the plan reduces downtime?
3. **Always:** where is diesel disappearing, and how much is it costing?

Existing monitoring (the baseline included) answers "what is the status
now?". It does not answer "what happens next, and what is the best action?".

## 2. Users and customers

| | Who | What they need from TowerIQ |
|---|---|---|
| Customer (pays) | Tower company: Infratel; also IHS and private towercos | Fewer SLA penalties, lower diesel loss, a defensible redundancy capex plan |
| Primary user | NOC operator / shift engineer | A ranked action queue with deadlines, not 400 blinking tiles |
| Secondary user | Field & fuel-logistics coordinator | Who to refuel first and by when |
| Decision maker | Operations / commercial / CFO | Kwacha at risk, payback per upgrade, SLA compliance |
| Beneficiary | MNO tenants (MTN, Airtel, Zamtel), regulator, subscribers | Uptime |

## 3. Differentiator: options considered

| Option | Real problem? | Demonstrable? | Novel vs. Galooli et al.? | Verdict |
|---|---|---|---|---|
| A. Fuel-theft forensics in litres/Kwacha | Yes | Yes | Partly; fuel-drop alarms are standard | Keep as **supporting** feature (Fuel Integrity) |
| B. Time-to-dark ("runway") per tower | Yes | Yes | No on its own; Galooli markets "Live Autonomy" ([Galooli](https://galooli.com/products/the-galooli-platform/)) | Necessary, not sufficient |
| C. Person-detection CCTV (TF.js) | Moderate | Yes | Low; commodity | Future |
| D. Refuel route optimisation | Yes | Hard without road data | Medium | Future |
| **E. Load-shedding-aware Resilience Engine: one digital-twin power model per tower feeding (1) probabilistic runway, (2) a deadline-ranked action queue in Kwacha, (3) a scenario + budget Redundancy Planner** | **Yes, directly answers the ZICTA directive** | **Yes: drag a load-shedding slider, watch the fleet turn red, see the ranked upgrade plan** | **High; turns monitoring data into the capex plan the regulator is demanding** | **Chosen** |

Why E beats the rest: it is the only option that links live telemetry to a
decision with a measured value (dark hours avoided, Kwacha protected,
payback months). It is tailored to Zambia's actual failure mode. And it
produces an artefact Infratel needs right now: a ranked, costed redundancy
plan.

## 4. How the Resilience Engine works (no AI-washing)

* **Site power model (digital twin).** It is a 15-minute energy-balance model:
  load (kW) is served by grid, then solar, then battery, then generator. The
  generator starts below a battery state-of-charge threshold and burns litres
  at the site's rate. If none can serve the load, the site goes **dark**.
  The *same* model drives the 30-day history, the live simulator and the
  forecast, so they are consistent by construction.
* **Learned grid pattern.** From each site's last 14 days of telemetry, the
  model learns a 2-state Markov chain per hour of day (P(grid fails), P(grid
  returns)). This captures load-shedding blocks. The parameters are learned,
  not hand-set.
* **Calibrated burn rate.** The model takes the median litres/hour from fuel-level
  drops while the generator ran. It falls back to the asset nameplate.
* **Monte Carlo forecast.** 200 runs × 72 h give the probability of going
  dark within 24 h, the median time-to-dark, expected dark hours, and the
  latest safe refuel time.
* **Money.** Dark hours × per-site SLA exposure (from tenant contracts) plus
  diesel cost. Every assumption is visible and editable on the Settings page.
* **Planner.** It re-runs the model with candidate upgrades (battery, solar,
  both) under a chosen load-shedding scenario, then ranks them by avoided
  downtime per Kwacha within a budget, and exports the plan as CSV.

## 5. Roadmap

| Pri | Item | Value |
|---|---|---|
| P0 | Fix all critical/high audit defects (auth escalation, XSS, WS auth, dashboard contract, CSV, GET-side-effects, switch log) | Credibility; judges will probe |
| P0 | Asset model + 30-day physically simulated history, clearly labelled | Meaningful SLA, utilisation and trends from minute one |
| P0 | Role enforcement (viewer/operator/admin), input validation, security headers, login throttling | Feasibility score |
| P1 | Resilience Engine: runway, action queue, planner | Signature innovation |
| P1 | Fuel Integrity: delivery-vs-burn-vs-level reconciliation in L and K | Measurable loss reduction |
| P1 | Demo scenario controls (start outage, siphon fuel, intrusion, refuel) | Repeatable 5-minute demo |
| P1 | Redesigned console (Command Center first) | Understandable in 30 s |
| P2 | Period-selectable utilisation reports, MTTA/MTTR, CSV exports | Brief coverage |
| P2 | Tests for engines and security | Reliability |
| P3 | Postgres/TimescaleDB, managed MQTT with TLS, TF.js person detection, refuel routing, SMS escalation, ZESCO schedule import | Production path |
