/* Dependency-free SVG charts. Colours come from CSS variables so both themes work.
   Each function renders into a container element at its current width. */
'use strict';

const Charts = {
  _w(el) { return Math.max(280, Math.floor(el.getBoundingClientRect().width || el.clientWidth || 600)); },

  /**
   * Blackout survival curve: P(site still powered) over the forecast horizon,
   * with hourly blackout probability as faint bars underneath.
   */
  survival(el, survival, darkByHour, { tolerance = 0.1 } = {}) {
    const W = this._w(el), H = 220, p = { l: 40, r: 12, t: 12, b: 26 };
    const maxH = survival[survival.length - 1].h;
    const x = (h) => p.l + (h / maxH) * (W - p.l - p.r);
    const y = (v) => p.t + (1 - v) * (H - p.t - p.b);
    let g = '';
    for (const v of [0, 0.25, 0.5, 0.75, 1]) g += `<line class="grid-line" x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${p.l - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`;
    for (let h = 0; h <= maxH; h += 12) g += `<text x="${x(h)}" y="${H - 6}" text-anchor="middle">${h === 0 ? 'now' : '+' + h + 'h'}</text>`;
    const bw = (W - p.l - p.r) / maxH;
    const bars = darkByHour.map((v, i) => v > 0.001 ? `<rect x="${x(i) + 0.5}" y="${y(v)}" width="${Math.max(1, bw - 1)}" height="${y(0) - y(v)}" fill="var(--crit)" opacity="0.28"/>` : '').join('');
    const pts = survival.map((s) => `${x(s.h).toFixed(1)},${y(s.pPowered).toFixed(1)}`).join(' ');
    const area = `${x(0)},${y(0)} ${pts} ${x(maxH)},${y(0)}`;
    const tol = `<line x1="${p.l}" x2="${W - p.r}" y1="${y(1 - tolerance)}" y2="${y(1 - tolerance)}" stroke="var(--watch)" stroke-dasharray="4 4" stroke-width="1"/><text x="${W - p.r}" y="${y(1 - tolerance) - 5}" text-anchor="end" style="fill:var(--watch)">act before the line drops below here</text>`;
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Probability the site stays powered over the next ${maxH} hours">
      ${g}${bars}<polygon points="${area}" fill="var(--brand)" opacity="0.12"/>
      <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linejoin="round"/>${tol}</svg>`;
  },

  /** 24h+ timeline: supply source band + fuel % and battery % lines. */
  timeline(el, points, { deliveries = [], theft = [] } = {}) {
    if (!points.length) { el.innerHTML = empty('No telemetry in this window').s; return; }
    const W = this._w(el), H = 210, p = { l: 40, r: 12, t: 10, b: 26 }, bandH = 18;
    const t0 = fmt.date(points[0].ts).getTime(), t1 = Date.now();
    const x = (t) => p.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - p.l - p.r);
    const top = p.t + bandH + 10;
    const y = (v) => top + (1 - v / 100) * (H - top - p.b);
    let g = '';
    for (const v of [0, 50, 100]) g += `<line class="grid-line" x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${p.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
    const step = (t1 - t0) > 2 * 86400000 ? 24 : 6;
    for (let t = Math.ceil(t0 / (step * 3600000)) * step * 3600000; t < t1; t += step * 3600000) {
      g += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</text>`;
    }
    const band = points.map((pt, i) => {
      const a = fmt.date(pt.ts).getTime(), b = i + 1 < points.length ? fmt.date(points[i + 1].ts).getTime() : Math.min(t1, a + 900000);
      return `<rect x="${x(a).toFixed(1)}" y="${p.t}" width="${Math.max(0.6, x(b) - x(a)).toFixed(1)}" height="${bandH}" fill="var(--src-${pt.source || 'none'})"><title>${fmt.time(pt.ts)} ${SOURCE_LABEL[pt.source] || pt.source}</title></rect>`;
    }).join('');
    const line = (key, color, dash = '') => {
      const pts = points.filter((pt) => pt[key] != null).map((pt) => `${x(fmt.date(pt.ts).getTime()).toFixed(1)},${y(pt[key]).toFixed(1)}`).join(' ');
      return pts ? `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>` : '';
    };
    const marks = deliveries.map((d) => `<g><line x1="${x(fmt.date(d.ts).getTime())}" x2="${x(fmt.date(d.ts).getTime())}" y1="${top}" y2="${y(0)}" stroke="var(--ok)" stroke-dasharray="2 3"/><text x="${x(fmt.date(d.ts).getTime()) + 4}" y="${top + 10}" style="fill:var(--ok)">+${Math.round(d.litres)} L</text></g>`).join('')
      + theft.map((d) => `<g><line x1="${x(fmt.date(d.ts).getTime())}" x2="${x(fmt.date(d.ts).getTime())}" y1="${top}" y2="${y(0)}" stroke="var(--crit)" stroke-dasharray="2 3"/><text x="${x(fmt.date(d.ts).getTime()) + 4}" y="${top + 22}" style="fill:var(--crit)">theft</text></g>`).join('');
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Supply source, fuel and battery over time">${g}${band}${line('fuelPct', 'var(--src-generator)')}${line('batteryPct', 'var(--src-battery)', '5 3')}${marks}</svg>`;
  },

  /** Single stacked horizontal bar from [{key, value, color, label}]. */
  stack(parts) {
    const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
    return raw(`<div class="waterfall" role="img" aria-label="${esc(parts.map((p) => `${p.label}: ${Math.round(p.value / total * 100)}%`).join(', '))}">${parts.map((p) => p.value > 0 ? `<span style="width:${(p.value / total * 100).toFixed(2)}%;background:${p.color}" title="${esc(p.label)}: ${Math.round(p.value / total * 100)}%"></span>` : '').join('')}</div>`);
  },

  /** Vertical bars with labels: [{label, value, color?}] */
  bars(el, data, { unit = '', max = null, height = 180 } = {}) {
    if (!data.length) { el.innerHTML = empty('No data').s; return; }
    const W = this._w(el), H = height, p = { l: 8, r: 8, t: 18, b: 34 };
    const m = max ?? Math.max(...data.map((d) => d.value), 1);
    const bw = (W - p.l - p.r) / data.length;
    const out = data.map((d, i) => {
      const bh = (d.value / m) * (H - p.t - p.b);
      const x0 = p.l + i * bw + bw * 0.18;
      return `<rect x="${x0}" y="${H - p.b - bh}" width="${bw * 0.64}" height="${Math.max(0, bh)}" rx="3" fill="${d.color || 'var(--info)'}"/>
        <text x="${x0 + bw * 0.32}" y="${H - p.b - bh - 5}" text-anchor="middle" style="fill:var(--text-2)">${esc(d.valueLabel ?? (Math.round(d.value) + unit))}</text>
        <text x="${x0 + bw * 0.32}" y="${H - 14}" text-anchor="middle">${esc(d.label)}</text>`;
    }).join('');
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(data.map((d) => `${d.label} ${Math.round(d.value)}${unit}`).join(', '))}"><line class="axis" x1="${p.l}" x2="${W - p.r}" y1="${H - p.b}" y2="${H - p.b}"/>${out}</svg>`;
  },
};

const SOURCE_COLORS = { grid: 'var(--src-grid)', solar: 'var(--src-solar)', battery: 'var(--src-battery)', generator: 'var(--src-generator)', dark: 'var(--src-none)', none: 'var(--src-none)' };
