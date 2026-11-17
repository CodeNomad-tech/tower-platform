# TowerIQ: Commercialisation Strategy

Legend: **[F]** verified fact with source · **[E]** estimate or assumption to be
validated in a pilot · **[S]** figure produced by the simulated demo (illustrative only).

## 1. Customer, user, value

| | |
|---|---|
| **Primary customer** | Infratel Corporation: state-owned (IDC) passive-infrastructure company with **1,282 towers** that sells tower space, backup power, security and **remote site monitoring** to MNOs, ISPs and government **[F]** ([Infratel](https://infratel.co.zm/company-profile/)) |
| **Users** | NOC operators and shift engineers (alarms, action queue); fuel-logistics coordinators (refuel deadlines); operations, finance and commercial managers (planner, SLA, revenue at risk) |
| **Why now** | ZICTA (Nov 2025) required Infratel and IHS to submit time-bound redundancy plans for all towers **[F]** ([TechAfrica](https://techafricanews.com/2025/11/04/zambia-issues-21-day-ultimatum-to-telecom-operators-over-poor-network-quality/)). Load-shedding reached 12–17 h/day in 2024 **[F]** ([Diggers](https://diggers.news/local/2024/08/17/govt-announces-17-hour-load-shedding-moves-to-hike-tariffs/)). Infratel also signed new colocation deals (e.g. with Airtel) that raise the cost of downtime **[F]** ([ITWeb](https://itweb.africa/content/wbrpOMgYoRrvDLZn)) |
| **Value proposition** | Fewer dark hours (and SLA credits), less unexplained diesel, capex spent where it removes the most downtime, and evidence for the regulator |

## 2. Where the money is (per site)

TowerIQ creates value through three mechanisms. The size of each must be
measured in a pilot. We deliberately do not quote industry-wide loss
statistics we could not verify.

| Mechanism | How TowerIQ measures it | Demo fleet figure |
|---|---|---|
| Diesel loss (theft, siphoning, inefficient generators) | Fuel Integrity reconciliation in litres × ERB price (K25.11/L, Jan 2026 **[F]**, [ERB](https://www.erb.org.zm/wp-content/uploads/PressStatements/CurrentFuelPumpPricesJanuary2026.pdf)) | ~K12,000 / 30 days across 12 sites **[S]** |
| Avoided dark hours (SLA credits, tenant churn, regulatory exposure) | Runway forecast + action queue; SLA reconstructed from status history | Kitwe 21 h and Mansa 58 h down in 30 days **[S]** |
| Better capex allocation | Planner benefit per Kwacha | 12 h/day scenario: fleet 128 → 1 dark h/month for K600k, ~12-month payback **[S]** |

## 3. Business model options

| Option | Description | Fit |
|---|---|---|
| **A. Enterprise licence to Infratel (recommended first)** | Annual licence + support, deployed on Infratel infrastructure (its Tier III data centres **[F]**) for data sovereignty | Matches a state-owned operator and the iHub incubation path |
| **B. Per-site SaaS** | Monthly fee per monitored site, tiered by features (monitoring / + forecasting / + planner) | Private towercos, ISPs, mining sites |
| **C. Infratel resells "Monitoring-as-a-Service"** | Infratel already lists remote site monitoring as a service **[F]**. TowerIQ becomes the product Infratel sells to MNO tenants and to other infrastructure owners with generators (water utilities, hospitals, banks' sites) | Creates new revenue for Infratel, not just cost savings |

**Pricing hypothesis [E].** Price as a fraction of measured savings, e.g. K150–K400
per site per month for software, validated against pilot-measured diesel and
SLA savings per site. At 1,282 sites, every K100/site/month is ≈ K1.54m/year
(arithmetic on the [F] tower count).

## 4. Costs to deploy [E]

| Item | Notes |
|---|---|
| Site hardware | Remote-monitoring controller with fuel-level sensor, DC/AC current sensing, door/temperature inputs. Many towers already have an RMS: TowerIQ's MQTT contract means it **ingests existing controllers via an adapter** rather than replacing them (see `startHardwareIngest`). Cost per site to be quoted by vendors in the pilot. |
| Connectivity | Telemetry is small JSON at ~10 s–5 min intervals; it rides the tower's own backhaul. |
| Hosting | Single VM to start (Node.js + SQLite). For the full fleet: PostgreSQL/TimescaleDB, managed MQTT broker with TLS, two app instances. |
| People | 1 product engineer + 1 integration engineer during incubation; NOC training (half a day; the console is task-oriented). |

## 5. Competition and alternatives

| Alternative | Strength | TowerIQ's angle |
|---|---|---|
| Galooli, other global RMS/energy platforms | Mature, hardware-agnostic, autonomy estimates and AI refuel planning **[F, vendor claims]** ([Galooli](https://galooli.com/products/the-galooli-platform/)) | Load-shedding-aware probabilistic runway tied to SLA money; regulator-ready capex planner; locally owned, deployable on Infratel's own data centres; priced for the local market |
| OEM generator/controller portals | Free with hardware | Single vendor; no fleet-wide reconciliation, forecasting or planning |
| Spreadsheets + NOC alarms | Familiar, cheap | Reactive; no forecast; fuel loss invisible |

## 6. Scalability and sustainability

* **Technical:** stateless HTTP and the forecast are per-site and embarrassingly
  parallel. The full-fleet runway on 12 sites takes ~0.3 s, i.e. ~30 ms per
  site, so 1,282 sites ≈ 35–40 s single-threaded **[E, linear extrapolation]**.
  That is spread across workers and cached, refreshed every few minutes. The
  storage migration path to Postgres/Timescale is documented
  (DATABASE.md).
* **Beyond towers:** the power model is generic: grid + solar + battery +
  generator + load. The same engine serves water pumping stations, rural
  clinics, bank branches and data-centre edge sites.
* **Beyond Zambia:** load-shedding and diesel dependence are regional issues
  (e.g. South Africa, Zimbabwe, Malawi). The grid model learns each site's
  pattern; nothing is Zambia-hardcoded except defaults (UTC+2, ERB price).
* **Sustainability:** the planner directly prioritises solar and battery
  where they displace the most diesel, so CO₂ reduction is a by-product that
  can be reported.

## 7. Path to deployment (iHub incubation)

| Phase | Duration | Exit criteria |
|---|---|---|
| 0. Data access | 2–4 weeks | Read-only export of 3 months of existing RMS/NOC data for 20 towers; MoU on data handling |
| 1. Back-test | 4 weeks | Run the forecast on historical data. Report Brier score for 24 h blackout probability and precision/recall of theft findings against known incidents |
| 2. Shadow pilot | 90 days, 20–50 towers | NOC uses the action queue alongside current process. KPIs: dark hours vs. control towers, unexplained litres, MTTA, refuels that prevented outages |
| 3. Production | 6–12 months | Postgres/Timescale, managed MQTT with TLS + per-device credentials, SSO, SMS escalation, ZESCO schedule import; roll out by province |

## 8. Partnerships

Infratel (customer, data, field validation) · UNZA iHub (incubation,
engineering students) · RMS/controller vendors (adapters) · fuel logistics
providers (delivery confirmation feeds) · ZESCO (published schedule data) ·
battery/solar integrators (planner-driven projects).
