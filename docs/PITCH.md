# TowerIQ: Presentation Outline (8–10 slides, ~6 minutes + demo)

Mapped to the judging criteria: Innovation 20 · Relevance 20 · Functionality
20 · Commercialisation 15 · Scalability 15 · Presentation 10.

| # | Slide | Content (keep each to one idea) | Criterion |
|---|---|---|---|
| 1 | **Title** | TowerIQ: *Know which towers will go dark, before they do.* Team names. Challenge 1: Smart Tower Monitoring & Infrastructure Intelligence | Presentation |
| 2 | **The problem in Zambia** | Load-shedding 8 → 12 → 17 h/day in 2024 (sources on slide). A tower survives on battery, solar and diesel. ZICTA, Nov 2025: Infratel has 21 days to submit a redundancy plan for all towers. Diesel theft is a known loss. | Relevance |
| 3 | **Why current monitoring isn't enough** | It reports that a site *is* down: reactive, so SLA credits are already accruing. Fuel loss is invisible until a reconciliation months later. Capex is decided without evidence. | Relevance |
| 4 | **TowerIQ in one picture** | Telemetry → digital twin per tower → (1) blackout runway, (2) do-this-next queue, (3) redundancy planner, plus fuel integrity. Covers every capability in the brief (show checklist on a side bar). | Innovation / Functionality |
| 5 | **LIVE DEMO** | Follow DEMO_SCRIPT.md: Overview → Kasama "order now" → Kitwe runway + 18 h scenario → live theft → planner slider → CSV | Functionality / Presentation |
| 6 | **How the intelligence works** | Learned hourly grid Markov chain + calibrated burn rate + 200 Monte Carlo runs of the site power model. Explainable, testable, no black box. 36 automated tests. | Innovation / Feasibility |
| 7 | **Business model** | First customer Infratel (1,282 towers); licence, per-site SaaS, or Infratel resells monitoring-as-a-service. Pricing as a share of measured savings. | Commercialisation |
| 8 | **Scale & sustainability** | Per-site, parallel computation; same engine for clinics, water pumps, bank sites; prioritises solar and battery where they displace the most diesel. | Scalability |
| 9 | **Pilot plan & asks** | Back-test on 3 months of real data → 90-day shadow pilot on 20–50 towers → production. KPIs: dark hours, unexplained litres, MTTA. Ask: data access + iHub incubation. | Commercialisation |
| 10 | **Close** | One sentence and the dashboard screenshot. | Presentation |

## Speaker notes: the three numbers to remember

* **12 → 17 h/day**: 2024 load-shedding (the threat).
* **21 days**: ZICTA's deadline for a redundancy plan (the urgency).
* **1,282 towers**: Infratel's fleet (the scale).

## Honesty rules for the presentation

* Say "simulated data" every time a figure from the demo is shown.
* Call the intelligence "probabilistic forecasting" or "learned models".
  Never claim deep learning.
* When asked about accuracy, answer "measured in the pilot". Point to the
  back-test plan (COMMERCIALISATION.md §7).
