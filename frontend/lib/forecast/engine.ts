/**
 * Server-side forecast engine.
 * Pure functions — no DOM / browser dependencies.
 */

export type ModelKey = "NAIVE" | "SNAIVE" | "SMA" | "SES" | "HOLT" | "HW";

export const ALL_MODEL_KEYS: ModelKey[] = ["NAIVE", "SNAIVE", "SMA", "SES", "HOLT", "HW"];

export type ModelParams = {
  alpha?: number; // SES / HOLT / HW level smoothing
  beta?: number;  // HOLT / HW trend smoothing
  gamma?: number; // HW seasonal smoothing
  window?: number; // SMA window
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// ---------- Individual models ----------

export function naiveForecast(series: number[], horizon: number): number[] {
  const last = series.at(-1) ?? 0;
  return Array.from({ length: horizon }, () => last);
}

export function snaiveForecast(series: number[], horizon: number, season = 12): number[] {
  const n = series.length;
  return Array.from({ length: horizon }, (_, i) => {
    const idx = n - season + (i % season);
    return series[idx] ?? series.at(-1) ?? 0;
  });
}

export function smaForecast(series: number[], horizon: number, window = 3): number[] {
  const w = clamp(window, 2, Math.max(2, series.length));
  const tail = series.slice(-w);
  const avg = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
  return Array.from({ length: horizon }, () => avg);
}

export function sesForecast(series: number[], horizon: number, alpha = 0.3): number[] {
  const a = clamp(alpha, 0.05, 0.95);
  let level = series[0] ?? 0;
  for (let i = 1; i < series.length; i++) level = a * series[i] + (1 - a) * level;
  return Array.from({ length: horizon }, () => level);
}

export function holtForecast(series: number[], horizon: number, alpha = 0.3, beta = 0.2): number[] {
  const a = clamp(alpha, 0.05, 0.95);
  const b = clamp(beta, 0.05, 0.95);
  let level = series[0] ?? 0;
  let trend = (series[1] ?? level) - level;
  for (let i = 1; i < series.length; i++) {
    const prevLevel = level;
    level = a * series[i] + (1 - a) * (level + trend);
    trend = b * (level - prevLevel) + (1 - b) * trend;
  }
  return Array.from({ length: horizon }, (_, h) => level + (h + 1) * trend);
}

export function hwForecast(
  series: number[],
  horizon: number,
  season = 12,
  alpha = 0.3,
  beta = 0.15,
  gamma = 0.2
): number[] {
  const n = series.length;
  const a = clamp(alpha, 0.05, 0.95);
  const b = clamp(beta, 0.05, 0.95);
  const g = clamp(gamma, 0.05, 0.95);

  const firstSeason = series.slice(0, season);
  const seasonAvg =
    firstSeason.reduce((x, y) => x + y, 0) / Math.max(1, firstSeason.length);
  const s: number[] = Array.from(
    { length: season },
    (_, i) => (firstSeason[i] ?? seasonAvg) - seasonAvg
  );

  let level = series[0] ?? 0;
  let trend = (series[1] ?? level) - level;

  for (let t = 0; t < n; t++) {
    const y = series[t] ?? 0;
    const si = s[t % season] ?? 0;
    const prevLevel = level;
    level = a * (y - si) + (1 - a) * (prevLevel + trend);
    trend = b * (level - prevLevel) + (1 - b) * trend;
    s[t % season] = g * (y - level) + (1 - g) * si;
  }

  return Array.from({ length: horizon }, (_, h) => {
    const si = s[(n + h) % season] ?? 0;
    return level + (h + 1) * trend + si;
  });
}

// ---------- Unified dispatch ----------

export function runModel(
  model: ModelKey,
  series: number[],
  horizon: number,
  params: ModelParams = {}
): number[] {
  const raw = (() => {
    switch (model) {
      case "NAIVE":
        return naiveForecast(series, horizon);
      case "SNAIVE":
        return snaiveForecast(series, horizon, 12);
      case "SMA":
        return smaForecast(series, horizon, params.window ?? 3);
      case "SES":
        return sesForecast(series, horizon, params.alpha ?? 0.3);
      case "HOLT":
        return holtForecast(series, horizon, params.alpha ?? 0.3, params.beta ?? 0.2);
      case "HW":
        return hwForecast(series, horizon, 12, params.alpha ?? 0.3, params.beta ?? 0.15, params.gamma ?? 0.2);
    }
  })();
  return raw.map((v) => Math.max(0, v));
}

export function modelMinHistory(model: ModelKey): number {
  switch (model) {
    case "NAIVE": return 1;
    case "SMA":   return 2;
    case "SES":   return 2;
    case "HOLT":  return 3;
    case "SNAIVE":return 12;
    case "HW":    return 12;
  }
}
