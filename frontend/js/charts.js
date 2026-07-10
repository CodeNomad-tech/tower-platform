// Tiny dependency-free chart renderer (canvas-based line, bar, and pie charts).
const Charts = {
  line(canvas, series, { color = '#3ea6ff', fill = true, yLabel = '', min = null, max = null } = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!series.length) {
      ctx.fillStyle = '#5a6678'; ctx.font = '12px sans-serif';
      ctx.fillText('No data yet', 10, h / 2);
      return;
    }

    const pad = { top: 10, right: 10, bottom: 20, left: 36 };
    const values = series.map(p => p.y);
    const yMin = min ?? Math.min(...values);
    const yMax = max ?? Math.max(...values, yMin + 1);
    const xMin = series[0].x, xMax = series[series.length - 1].x || xMin + 1;

    const xScale = (x) => pad.left + ((x - xMin) / Math.max(1, xMax - xMin)) * (w - pad.left - pad.right);
    const yScale = (y) => h - pad.bottom - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * (h - pad.top - pad.bottom);

    // gridlines
    ctx.strokeStyle = '#1e2735'; ctx.lineWidth = 1;
    ctx.fillStyle = '#5a6678'; ctx.font = '10px sans-serif';
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (i / 3) * (h - pad.top - pad.bottom);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
      const val = yMax - (i / 3) * (yMax - yMin);
      ctx.fillText(val.toFixed(0), 2, y + 3);
    }

    // line path
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xScale(p.x), y = yScale(p.y);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    if (fill) {
      ctx.lineTo(xScale(series[series.length - 1].x), h - pad.bottom);
      ctx.lineTo(xScale(series[0].x), h - pad.bottom);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
      grad.addColorStop(0, color + '33'); grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad; ctx.fill();
    }
  },

  pie(canvas, data, { colors = ['#3ea6ff', '#2dc653', '#ff9f43', '#ff5e57', '#8b5cf6'] } = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 220, h = canvas.clientHeight || 220;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const safeData = (data || []).filter(item => Number(item.value || 0) > 0);
    const total = safeData.reduce((sum, item) => sum + Number(item.value || 0), 0);

    if (!safeData.length || !total) {
      ctx.fillStyle = '#5a6678'; ctx.font = '12px sans-serif';
      ctx.fillText('No data yet', 10, h / 2);
      return;
    }

    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.min(w, h) / 2 - 16;
    let startAngle = -Math.PI / 2;

    safeData.forEach((item, index) => {
      const slice = (Number(item.value || 0) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + slice);
      ctx.closePath();
      ctx.fillStyle = item.color || colors[index % colors.length];
      ctx.fill();
      startAngle += slice;
    });

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();

    ctx.fillStyle = '#e8edf4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(String(total), centerX, centerY - 4);
    ctx.font = '11px sans-serif';
    ctx.fillText('total', centerX, centerY + 14);
  },

  bar(canvas, data, { color = '#3ea6ff', labelKey = 'label', valueKey = 'value' } = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!data.length) {
      ctx.fillStyle = '#5a6678'; ctx.font = '12px sans-serif';
      ctx.fillText('No data yet', 10, h / 2);
      return;
    }

    const pad = { top: 10, right: 10, bottom: 24, left: 10 };
    const max = Math.max(...data.map(d => d[valueKey]), 1);
    const barW = (w - pad.left - pad.right) / data.length;

    data.forEach((d, i) => {
      const barH = ((d[valueKey] / max) * (h - pad.top - pad.bottom)) || 0;
      const x = pad.left + i * barW + barW * 0.15;
      const y = h - pad.bottom - barH;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW * 0.7, barH);
      ctx.fillStyle = '#8b98ab'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d[labelKey], x + barW * 0.35, h - 8);
      ctx.fillStyle = '#e8edf4';
      ctx.fillText(d[valueKey].toFixed(0), x + barW * 0.35, y - 4);
    });
    ctx.textAlign = 'left';
  },
};
