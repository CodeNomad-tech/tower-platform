# TowerIQ: 5-Minute Live Demo Script

Everything shown is live, working software running on one laptop with no
internet connection. All site data is **simulated** (the console says so in the
top bar).

## Before you present (10 minutes earlier)

```bash
cd backend
npm run demo:reset     # fresh simulated fleet + 30 days of history
npm start              # http://localhost:3000
```

* Open http://localhost:3000 in a browser at 100–110% zoom. Use **light
  theme** on projectors (sun/moon button, top right).
* Sign in as **admin@toweriq.demo / ChangeMe123!** (pre-filled).
* Open a **second tab** on *Settings & Demo* for the scenario controls.
* Optional: pair a phone camera (Settings → Pair a phone camera node). This
  needs HTTPS; see DEPLOYMENT.md (tunnel).
* Rehearse once. The simulated fleet is deterministic from history, but live
  telemetry is real-time, so exact numbers will differ slightly from the
  ones below.

## The script

| # | Time | Say | Do | Expected result |
|---|---|---|---|---|
| 1 | 0:00 | "In 2024 ZESCO load-shedding reached 12, then 17 hours a day. A tower survives on battery, solar and diesel. In November 2025 ZICTA gave Infratel 21 days to produce a redundancy plan for **all** towers." | Show the sign-in page (left panel states the purpose). | Judges read the one-line promise. |
| 2 | 0:30 | "Today's monitoring tells you a tower **has** gone dark. Too late: tenants are already off air and SLA credits are accruing." | Sign in. | Overview loads. |
| 3 | 0:45 | "TowerIQ asks a different question: *which towers will go dark, and what do I do first?*" | Point at the **map** (green = fine, orange = needs attention, red = urgent), then the cards on the right. | "3 of 12 towers need your attention"; Kasama Hill card says *order 349 litres now*. |
| 4 | 1:15 | "Kasama has 11% fuel. That looks fine for today, with 0% risk in 24 h. But the truck takes 72 hours to get there. TowerIQ knows that, so it says order **now**." | Hover or point at the action's detail and basis line. | Shows "83% chance of blackout within 72 h… lead time 72 h… order must go out now", with Kwacha value. |
| 5 | 1:45 | "Every forecast comes from that tower's own data: its grid pattern learned over 14 days, its measured burn rate, 200 simulations." | Click **Open site** on Kitwe Highway. | Runway panel: median time to blackout, survival curve, "Why: generator runs out of diesel (2.6 L/h measured, plus 0.27 L/h unexplained loss)". |
| 6 | 2:15 | "What if load-shedding goes to 18 hours?" | Click **18 h/day** on the runway panel. | Curve drops sharply; blackout probability rises. |
| 7 | 2:30 | "That unexplained loss is diesel walking away." | Scroll to **Fuel integrity, 30 days** card. | Opening + delivered − expected burn − closing = ~250 L unexplained, "pattern consistent with siphoning". |
| 8 | 2:50 | "Let's steal some fuel, live." | In the Settings tab: Site **Livingstone Relay**, Event **Fuel siphoned**, 150 L → **Trigger**. Switch back to Overview. | Within ~10 s: toast "Fuel theft", alarm badge 1, Livingstone turns **red on the map** and gets a card saying the fuel vanished. |
| 9 | 3:20 | "And the ZICTA question: with K600,000, where do I put batteries and solar first?" | Open **Resilience Planner**. Drag slider 8 → 12 → 18 h/day. | Fleet dark hours/month before → after, capex, monthly benefit, payback; ranked plan reorders (Mansa Lakeside first). |
| 10 | 4:00 | "That is the time-bound redundancy plan, costed and ranked, in one click." | Click **Export plan CSV**. | CSV downloads with rank, upgrade, capex, avoided dark hours, payback. |
| 11 | 4:20 | "This scales beyond 12 towers and beyond telecom. Anything with a generator and a grid connection has the same problem." | Optional: show phone camera node raising an intrusion; or Commercial page "Fix power first" vs "Ready to sell". | |
| 12 | 4:40 | "TowerIQ: know which towers will go dark, before they do." | Return to Overview. | |

## Recovery plans

| If… | Then… |
|---|---|
| Headline says all sites secure | Run `npm run demo:reset` and restart; or trigger an 18 h outage at Kitwe Highway from Settings. |
| Theft alarm doesn't appear | Wait one telemetry tick (10 s). The alarm only fires once per open theft alarm, so resolve the old one first. |
| Browser shows the sign-in page again | Session expired (12 h). Sign in again; data is unaffected. |
| Venue projector washes out colours | Switch to light theme. |
| Questions on accuracy | "These are simulated sites. The method is validated by tests; real accuracy is what the pilot measures." See RESILIENCE_ENGINE.md §5–6. |

## Likely judge questions (and honest answers)

* **"Is this AI?"** It is probabilistic forecasting. The model learns each
  tower's grid failure and restore probabilities by hour and its real fuel
  consumption, then runs Monte Carlo simulations. We do not call it a neural
  network, because it isn't one. It is explainable by design.
* **"Is the data real?"** No. It is a simulated 12-site fleet generated by the
  same physical model, labelled as simulated throughout. The ingest contract
  (MQTT topics) is the one real RMS hardware would use; see
  HARDWARE_SIMULATION.md.
* **"How does this differ from Galooli?"** They are a mature global platform
  and already estimate autonomy. Our focus is load-shedding-aware blackout
  *probability* tied to SLA money, delivery lead times, and a capex planner
  that answers the regulator's redundancy directive. It runs on one small
  server, which suits Infratel's data-sovereignty and cost needs.
* **"What does it cost to deploy?"** See COMMERCIALISATION.md: an RMS
  controller per site (which many towers already have) plus one server.
