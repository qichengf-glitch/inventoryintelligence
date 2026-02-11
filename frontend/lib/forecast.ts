// /lib/forecast.ts
export type TSPoint = { date: string; y: number };

export type ForecastResult = {
  fitted: TSPoint[];       // in-sample fitted values aligned to input dates
  forecast: TSPoint[];     // out-of-sample forecast points
};

function clampNumber(x: number) {
  return Number.isFinite(x) ? x : 0;
}

export function smaForecast(
  series: TSPoint[],
  window: number,
  horizon: number
): ForecastResult {
  const n = series.length;
  if (n === 0) return { fitted: [], forecast: [] };
  const w = Math.max(1, Math.floor(window));

  // fitted: average of last w actuals up to t-1 (or t)
  const fitted: TSPoint[] = series.map((p, i) => {
    const start = Math.max(0, i - w + 1);
    const slice = series.slice(start, i + 1).map((s) => s.y);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    return { date: p.date, y: clampNumber(avg) };
  });

  // forecast: iteratively use last w values (actual + forecasts)
  const values = series.map((p) => p.y);
  const forecast: TSPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    const start = Math.max(0, values.length - w);
    const slice = values.slice(start);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    values.push(avg);

    const nextDate = addDaysISO(series[n - 1].date, k);
    forecast.push({ date: nextDate, y: clampNumber(avg) });
  }

  return { fitted, forecast };
}

export function sesForecast(
  series: TSPoint[],
  alpha: number,
  horizon: number
): ForecastResult {
  const n = series.length;
  if (n === 0) return { fitted: [], forecast: [] };

  const a = Math.min(1, Math.max(0.01, alpha));
  let level = series[0].y;

  const fitted: TSPoint[] = series.map((p, i) => {
    // one-step-ahead fitted is previous level
    const yhat = i === 0 ? series[0].y : level;
    level = a * p.y + (1 - a) * level;
    return { date: p.date, y: clampNumber(yhat) };
  });

  // SES forecasts are flat at last level
  const forecast: TSPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    forecast.push({
      date: addDaysISO(series[n - 1].date, k),
      y: clampNumber(level),
    });
  }

  return { fitted, forecast };
}

export function holtForecast(
  series: TSPoint[],
  alpha: number,
  beta: number,
  horizon: number
): ForecastResult {
  const n = series.length;
  if (n === 0) return { fitted: [], forecast: [] };

  const a = Math.min(1, Math.max(0.01, alpha));
  const b = Math.min(1, Math.max(0.01, beta));

  // initialize
  let level = series[0].y;
  let trend = n >= 2 ? series[1].y - series[0].y : 0;

  const fitted: TSPoint[] = series.map((p, i) => {
    const yhat = i === 0 ? p.y : level + trend; // one-step-ahead
    const prevLevel = level;
    level = a * p.y + (1 - a) * (level + trend);
    trend = b * (level - prevLevel) + (1 - b) * trend;
    return { date: p.date, y: clampNumber(yhat) };
  });

  const forecast: TSPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    forecast.push({
      date: addDaysISO(series[n - 1].date, k),
      y: clampNumber(level + k * trend),
    });
  }

  return { fitted, forecast };
}

export function mape(actual: number[], predicted: number[]) {
  const n = Math.min(actual.length, predicted.length);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const p = predicted[i];
    if (a === 0) continue;
    sum += Math.abs((a - p) / a);
    cnt++;
  }
  return cnt === 0 ? 0 : (sum / cnt) * 100;
}

export function bias(actual: number[], predicted: number[]) {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += predicted[i] - actual[i];
  return sum / n; // >0 means over-forecast
}

function addDaysISO(isoDate: string, days: number) {
  // expects YYYY-MM-DD
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
