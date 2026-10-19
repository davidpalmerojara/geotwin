import { describe, expect, it } from 'vitest';
import { activeAlarm, annunciatorAlarm } from './annunciator';

const alert = (id: string, severity: 'critical' | 'warning', at: string, status = 'active') => ({
  id,
  severity,
  status: status as 'active' | 'resolved',
  triggered_at: `2026-10-19T${at}:00Z`,
});
// The sonda at the laguna (critical, the latest), the gateway at Torrelago (critical) and a
// pump at the laguna (warning).
const sonda = alert('sonda', 'critical', '10:05'),
  pasarela = alert('pasarela', 'critical', '10:00'),
  bomba = alert('bomba', 'warning', '10:10');
const network = [pasarela, sonda, bomba];

describe('the alarm', () => {
  it('is the most severe, then the latest, with how many others', () => {
    const alarm = activeAlarm(network)!;
    expect(alarm.alert.id).toBe('sonda');
    expect(alarm.others).toBe(2);
    expect(alarm.same).toBe(2);
    expect(activeAlarm([alert('x', 'critical', '09:00', 'resolved')])).toBeNull();
  });
  it('is the network’s with «Todas las instalaciones»', () => {
    const { alarm, elsewhere } = annunciatorAlarm(false, undefined, network);
    expect(alarm!.alert.id).toBe('sonda');
    expect(elsewhere).toBeNull();
  });
  it('follows the chosen installation and counts the others apart', () => {
    // Torrelago: its own gateway, never the laguna's sonda (the network's latest critical).
    const { alarm, elsewhere } = annunciatorAlarm(true, [pasarela], network);
    expect(alarm!.alert.id).toBe('pasarela');
    expect(alarm!.others).toBe(0);
    expect(elsewhere).toEqual({ count: 2, severity: 'critical' });
  });
  it('has no alarm of its own when only another installation has alerts', () => {
    const { alarm, elsewhere } = annunciatorAlarm(true, [], [bomba]);
    expect(alarm).toBeNull();
    expect(elsewhere).toEqual({ count: 1, severity: 'warning' });
    expect(annunciatorAlarm(true, [pasarela], [pasarela]).elsewhere).toBeNull();
  });
});
