/**
 * The Admin-set defaults of a new PCR protocol (Settings, FR-ADM-03): annealing temperature and
 * cycles. Loaded once when the app starts; until then the built-in 60 °C / 35 cycles apply. The forms
 * pre-fill from here and run the same validation as the API with the same values.
 */
import type { ProtocolDefaults } from '../../domain/protocolTemplates';
import { request } from './api';

let current: ProtocolDefaults = {};

export const protocolDefaults = (): ProtocolDefaults => current;

export function setProtocolDefaults(next: ProtocolDefaults): void {
  current = next;
}

export async function loadProtocolDefaults(): Promise<void> {
  try {
    const settings = await request<{ defaultAnnealingC: number; defaultCycles: number }>(
      '/api/settings/public',
    );
    current = { annealing_c: settings.defaultAnnealingC, cycles: settings.defaultCycles };
  } catch {
    /* keep the built-in defaults */
  }
}
