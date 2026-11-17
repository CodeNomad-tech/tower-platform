# The Resilience Engine: TowerIQ's Signature Capability

> **Most tower monitoring tells you a site has gone dark. TowerIQ tells you
> which towers will go dark during the next load-shedding block, what to send
> where and by when, and which upgrades remove the most downtime per Kwacha.**

## 1. The problem it solves

In Zambia, tower downtime is mostly a power problem. In 2024 ZESCO
load-shedding rose from 8 h/day (March) to 12 h/day (May) and 17 h/day
(September), with reports of up to 21 h at the worst point
([Lusaka Times](https://www.lusakatimes.com/2024/03/08/zesco-announces-8-hour-daily-load-shedding-starting-march-11-2024/),
[Diggers](https://diggers.news/local/2024/08/17/govt-announces-17-hour-load-shedding-moves-to-hike-tariffs/),
[Wikipedia](https://en.wikipedia.org/wiki/2024_Zambian_drought)). Whether a
tower stays on air then depends on its battery, solar, diesel stock and how
quickly a fuel truck can reach it.

In November 2025 ZICTA gave Infratel and IHS **21 days to submit a detailed,
time-bound action plan for redundancy on all communication towers**
([TechAfrica News](https://techafricanews.com/2025/11/04/zambia-issues-21-day-ultimatum-to-telecom-operators-over-poor-network-quality/)).
A dashboard of current status cannot produce that plan. A forecast can.

## 2. What it does (three outputs, one model)

| Output | Question answered | Where in the product |
|---|---|---|
| **Blackout runway** | For each tower: probability of going dark in 24 h / 72 h, median time to dark, cause (fuel vs. backup capacity), expected dark hours and Kwacha exposure | Command Center "Fleet runway"; Site page |
| **Do-this-next queue** | Which refuels, responses and pre-positioning come first, the latest time to dispatch (accounting for each site's delivery lead time), and what each action protects in Kwacha | Command Center |
| **Redundancy planner** | Under a load-shedding scenario (0–20 h/day or each site's learned pattern), which battery/solar upgrade at which site removes the most downtime + diesel per Kwacha, funded greedily within a budget, exported as CSV | Resilience Planner |

## 3. How it works

```
 site telemetry ──► calibration ──────────────┐
  (fuel, battery,     • grid: 2-state Markov   │
   grid, generator)     chain per hour-of-day  ├──► site power model ──► Monte Carlo ──► runway / actions / plan
                      • burn rate (L/h)        │    (15-min energy        200 runs × 72 h (forecast)
 asset register ──────• standing loss (L/h)    │     balance)             16 runs × 30 d (planner, with refuel policy)
 (kW, kWh, kWp, L)                             │
 business assumptions (K/L, SLA terms, capex) ─┘
```

1. **Site power model** (`backend/src/engine/powerModel.js`). It is a 15-minute
   energy balance. Load is served by grid → solar → battery → generator. The
   generator starts at 30% battery state of charge (immediately if there is no
   battery), stops at 90% or when the grid returns, and burns diesel at the
   site's rate while it runs. If nothing can carry the load, the site is
   **dark**. **The same function** generates the demo history, drives the live
   simulator and runs the forecast, so all three are consistent by construction.
2. **Learned grid behaviour** (`gridModel.learnMarkov`). The site's last 14
   days of grid telemetry are resampled to 15-minute buckets. For each local
   hour the model estimates P(grid fails | up) and P(grid returns | down),
   which captures the daily rhythm of load-shedding without being told the
   schedule. Laplace smoothing keeps sparse hours sane.
3. **Calibrated consumption** (`predictiveEngine.fuelFlows`). The burn rate is
   measured from fuel-level drop while the generator ran, and the standing loss
   from gradual drop while it was off (leaks or siphoning). The forecast uses
   what the tank really loses, not the nameplate figure.
4. **Monte Carlo** (`resilience.forecastSite`). 200 runs × 72 h at 15-minute
   steps, each with a different sampled grid path and daily cloud cover. The
   outputs are a survival curve, P(dark ≤ 24 h / 72 h), the median and
   10th-percentile time to dark ("act by"), expected dark hours, and the
   dominant cause.
5. **Money** (`settings.js`, editable by an admin). Exposure per dark hour =
   tenants' monthly fees ÷ 730 h × SLA-credit multiplier. Diesel is valued at
   the ERB pump price (K25.11/L, January 2026). Capex uses planning unit costs.
   **All are visible assumptions, not hidden constants.**
6. **Planner** (`resilience.planUpgrades`). Each site is simulated for 30 days
   under the chosen scenario with a realistic refuel policy (request at 25%,
   delivered after the site's lead time ± 25%). It is simulated again with
   each candidate upgrade. Benefit = avoided dark hours × exposure + diesel
   saved × price. Upgrades paying back within 48 months are ranked by benefit
   per Kwacha and funded greedily up to the budget.

Performance on the 12-site demo fleet: full-fleet runway ≈ 0.3 s; planner ≈
0.5 s (measured on the development laptop). Both are cached briefly and
recomputed every minute.

## 4. Why this is the right differentiator

* **It turns data into a decision with a measurable value.** Every
  recommendation carries a deadline and a Kwacha figure, and its basis is
  shown.
* **It is local by design.** It models load-shedding blocks, refuel lead
  times on Zambian roads, and ERB diesel prices, rather than generic uptime.
* **It produces the artefact the regulator asked for.** The planner's CSV is a
  ranked, costed, time-boundable redundancy plan for the whole fleet.
* **It is explainable.** There is no black box. Each number traces back to the
  power model, the learned grid probabilities and the stated assumptions. A
  judge or engineer can reproduce it.
* **It is honest about competition.** Commercial platforms such as Galooli
  already market energy "autonomy" estimates and AI refuel planning
  ([Galooli](https://galooli.com/products/the-galooli-platform/), vendor
  claims). TowerIQ's contribution is the **load-shedding-aware probabilistic
  forecast tied to SLA money and a capex planner**, built for the operator's
  own regulatory situation, running on commodity infrastructure.

Alternatives considered and why they were not chosen as *the* signature
feature are listed in [STRATEGY.md](STRATEGY.md#3-differentiator-options-considered).

## 5. Validation performed

Automated tests (`backend/tests/engine.test.js`, all passing):
* Energy balance: battery-only site with 4 kWh at 2 kW goes dark at exactly 2 h.
* Generator start threshold and burn per step.
* Load-shedding schedules remove the configured hours per day.
* Forecast monotonicity: less fuel ⇒ higher blackout probability; fuel-limited
  vs. capacity-limited causes identified correctly.
* Planner: adding battery to a battery-only site avoids dark hours; heavier
  load-shedding never reduces projected dark hours (API test).

Scenario checks run during development on the simulated fleet (not real data):
* The fuel-limited remote site (Kasama, 72 h lead time) is flagged "order now"
  even though its 24 h risk is ~0%. That is correct: the truck takes 3 days.
* The battery-only site (Mansa) is flagged "capacity-limited". The planner
  ranks it first (+10 kWh battery, ~6-month payback at 12 h/day).
* Logging a delivery at Kitwe moves it from high risk to secure on the next
  telemetry tick.

## 6. Limitations (stated plainly)

* **Not yet validated on real tower data.** All figures in the demo come from
  the simulated fleet. A pilot must compare forecasts with actual outages
  (target metric: Brier score of 24 h blackout probability).
* The model assumes constant site load and a constant generator burn rate at
  that load. It ignores battery ageing and temperature derating, and rectifier
  and charging losses.
* The Markov grid model learns time-of-day structure but not announced
  schedule changes. Importing ZESCO's published schedules is on the roadmap.
* The SLA credit multiplier and capex unit costs are placeholders. They must be
  replaced with actual MSA terms and procurement prices before any Kwacha
  figure is used for decisions.
* The greedy budget allocation is near-optimal for this problem but not a
  formal optimisation (an ILP would guarantee optimality for larger fleets).
