import type { Asset } from '@geotwin/shared';
/** Spanish count with singular/plural noun: "1 sensor activo", "3 sensores activos". */
export function count(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}
/** Hemisphere-aware coordinates: 41.65523° N, 4.73700° O (Spanish uses O for oeste). */
export function coordinates(lat: number, lng: number, digits = 5) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'O';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lng).toFixed(digits)}° ${ew}`;
}
export const assetTypeLabel: Record<Asset['type'], string> = {
  pump: 'Bomba',
  transformer: 'Transformador',
  reservoir: 'Depósito',
  gateway: 'Pasarela de datos',
  valve: 'Válvula',
  turbine: 'Turbina',
  level_probe: 'Sonda de nivel',
};
export const metricLabel = (metric: string) =>
  metric === 'temperature'
    ? 'Temperatura'
    : metric === 'vibration'
      ? 'Vibración'
      : metric === 'pressure'
        ? 'Presión'
        : metric === 'level'
          ? 'Nivel'
          : metric;
/** Two-letter initials for an organization badge. */
export function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '—';
}
/** Spanish number with up to `digits` decimals, none when not needed: 1,7 · 85 · 0,25. */
export function decimal(value: number, digits = 2) {
  return value.toLocaleString('es-ES', { maximumFractionDigits: digits });
}
/** Spanish number with a fixed number of decimals: 1234,5 · 18.245,6 · 5540. */
export function number(value: number, digits = 0) {
  return value.toLocaleString('es-ES', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
