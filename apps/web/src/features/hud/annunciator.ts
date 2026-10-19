/**
 * What the annunciator shows, as pure functions. Its counts follow the chosen installation, and so
 * does its alarm: with an installation chosen, an alarm of another one never names its asset
 * there; it is counted in «+n en otras instalaciones», which opens Alertas for the whole network.
 * With «Todas las instalaciones» the alarm is the network's.
 */
import type { Alert } from '@geotwin/shared';

type AlertLike = Pick<Alert, 'id' | 'status' | 'severity' | 'triggered_at'>;

/** The most severe active alert, the most recent among equals, and how many others there are. */
export function activeAlarm<T extends AlertLike>(alerts: T[] | undefined) {
  const active = (alerts ?? []).filter((a) => a.status === 'active');
  if (!active.length) return null;
  const sorted = [...active].sort(
    (a, b) =>
      Number(b.severity === 'critical') - Number(a.severity === 'critical') ||
      b.triggered_at.localeCompare(a.triggered_at),
  );
  const same = active.filter((a) => a.severity === sorted[0]!.severity).length;
  return { alert: sorted[0]!, others: sorted.length - 1, same };
}

export interface Elsewhere {
  /** Active alerts of the other installations. */
  count: number;
  /** The most severe of them. */
  severity: 'critical' | 'warning';
}

/**
 * The alarm of the chosen installation (`installation`: its active alerts) or, with none chosen,
 * of the network (`network`: every active alert), and the active alerts of other installations.
 */
export function annunciatorAlarm<T extends AlertLike>(
  chosen: boolean,
  installation: T[] | undefined,
  network: T[] | undefined,
): { alarm: ReturnType<typeof activeAlarm<T>>; elsewhere: Elsewhere | null } {
  if (!chosen) return { alarm: activeAlarm(network), elsewhere: null };
  const here = new Set((installation ?? []).map((a) => a.id));
  const others = (network ?? []).filter((a) => a.status === 'active' && !here.has(a.id));
  return {
    alarm: activeAlarm(installation),
    elsewhere: others.length
      ? {
          count: others.length,
          severity: others.some((a) => a.severity === 'critical') ? 'critical' : 'warning',
        }
      : null,
  };
}
