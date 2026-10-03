import { currentProtocols } from '../../domain/currentProtocols';
import { ageInMonths, needsBreeding } from '../../domain/breeding';
import type { CryoRecordRow, IdProtocolRow, LineRow } from '../db/types';

export interface DashboardLine {
  id: string;
  name: string;
  gene: string | null;
  dob: string | null;
  ageMonths: number | null;
  idMethod: string;
  idedNumber: number;
}

export interface BreedingLine {
  id: string;
  name: string;
  breedingStartedAt: string | null;
  days: number | null;
}

export interface MissingDobLine {
  id: string;
  name: string;
  status: LineRow['status'];
}

export interface DashboardLists {
  counters: { active: number; closed: number; cryopreserved: number };
  upcoming: DashboardLine[];
  currentlyBreeding: BreedingLine[];
  missingDob: MissingDobLine[];
}

function isActive(line: LineRow): boolean {
  return line.status === 'Current' || line.status === 'Breeding';
}

/** BR-3 dashboard lists and counters, with the lab's calendar date supplied by the caller. */
export function buildDashboardLists(input: {
  lines: readonly LineRow[];
  protocols: readonly IdProtocolRow[];
  cryoRecords: readonly CryoRecordRow[];
  thresholdMonths: number;
  today: string;
}): DashboardLists {
  const protocolsByLine = new Map<string, IdProtocolRow[]>();
  for (const protocol of input.protocols)
    protocolsByLine.set(protocol.line_id, [
      ...(protocolsByLine.get(protocol.line_id) ?? []),
      protocol,
    ]);
  const cryoLineIds = new Set(input.cryoRecords.map((record) => record.line_id));
  const upcoming = input.lines
    .filter((line) => needsBreeding(line, input.today, input.thresholdMonths).needsBreeding)
    .sort((a, b) => (a.dob ?? '').localeCompare(b.dob ?? '') || a.name.localeCompare(b.name))
    .map((line): DashboardLine => ({
      id: line.id,
      name: line.name,
      gene: line.gene,
      dob: line.dob,
      ageMonths: line.dob === null ? null : ageInMonths(line.dob, input.today),
      idMethod:
        currentProtocols(line.current_protocol_id, protocolsByLine.get(line.id) ?? [])
          .map((protocol) => protocol.label)
          .join(', ') || 'None',
      idedNumber: line.ided_number,
    }));
  const currentlyBreeding = input.lines
    .filter((line) => line.status === 'Breeding')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((line): BreedingLine => ({
      id: line.id,
      name: line.name,
      breedingStartedAt: line.breeding_started_at,
      days:
        line.breeding_started_at === null
          ? null
          : Math.max(
              0,
              Math.floor(
                (Date.parse(`${input.today}T00:00:00Z`) -
                  Date.parse(`${line.breeding_started_at.slice(0, 10)}T00:00:00Z`)) /
                  86_400_000,
              ),
            ),
    }));
  const missingDob = input.lines
    .filter(
      (line) =>
        isActive(line) && needsBreeding(line, input.today, input.thresholdMonths).missingDob,
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((line): MissingDobLine => ({ id: line.id, name: line.name, status: line.status }));

  return {
    counters: {
      active: input.lines.filter(isActive).length,
      closed: input.lines.filter((line) => line.status === 'Closed').length,
      cryopreserved: cryoLineIds.size,
    },
    upcoming,
    currentlyBreeding,
    missingDob,
  };
}
