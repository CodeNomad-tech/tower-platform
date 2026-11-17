'use strict';
const { Router, num } = require('../router');
const { requireAuth } = require('../../auth/auth');
const resilience = require('../../engine/resilience');

const router = new Router();

const scenario = (q) => (q.loadShedding === undefined || q.loadShedding === '' || q.loadShedding === 'learned') ? null : num(q.loadShedding, 'loadShedding', { min: 0, max: 24 });

router.get('/runway', requireAuth, (req, res) => res.json(resilience.fleetRunway({ scenarioH: scenario(req.query) })));

router.get('/actions', requireAuth, (req, res) => res.json(resilience.actionQueue()));

router.get('/plan', requireAuth, (req, res) => {
  const budgetK = num(req.query.budget ?? 1500000, 'budget', { min: 0, max: 1e10 });
  res.json(resilience.planUpgrades({ scenarioH: scenario(req.query), budgetK }));
});

// The ranked, costed plan as CSV: the "time-bound redundancy plan" artefact.
router.get('/plan.csv', requireAuth, (req, res) => {
  const budgetK = num(req.query.budget ?? 1500000, 'budget', { min: 0, max: 1e10 });
  const p = resilience.planUpgrades({ scenarioH: scenario(req.query), budgetK });
  const head = ['rank', 'site_id', 'site_name', 'upgrade', 'capex_k', 'dark_h_per_month_now', 'dark_h_avoided_per_month', 'diesel_saved_l_per_month', 'monthly_benefit_k', 'payback_months', 'funded_within_budget'];
  const rows = p.plan.map((x, i) => {
    const s = p.sites.find(y => y.siteId === x.siteId);
    return [i + 1, x.siteId, x.name, x.option.label, Math.round(x.option.capexK), s.baseline.darkHours.toFixed(1), x.option.avoidedDarkH.toFixed(1),
      Math.round(x.option.dieselSavedL), Math.round(x.option.monthlyBenefitK), x.option.paybackMonths ? x.option.paybackMonths.toFixed(1) : '', x.funded ? 'yes' : 'no'];
  });
  const lines = [`# TowerIQ redundancy plan. Scenario: ${p.scenario}. Budget K${budgetK}. Generated ${p.generatedAt}. Assumptions: ${JSON.stringify(p.assumptions)}`, head.join(','), ...rows.map(r => r.join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="toweriq-redundancy-plan.csv"');
  res.send(lines.join('\n'));
});

module.exports = router;
