import { isIsoDate } from './dates';
import type { GenotypingInput, LineDoc, LineStatus } from './types';

export class InvalidTransitionError extends Error {
  constructor(from: LineStatus, to: LineStatus) {
    super(`A line cannot move from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
  }
}

export class InvalidGenotypingInputError extends Error {
  /** The form field the message belongs to, so the API and the form can show it inline. */
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'InvalidGenotypingInputError';
  }
}

function copyLine(line: LineDoc, changes: Partial<LineDoc>): LineDoc {
  return { ...line, ...changes };
}

function assertIsoDate(value: string, label: string, field?: string): void {
  if (!isIsoDate(value))
    throw new InvalidGenotypingInputError(`${label} must be a valid YYYY-MM-DD date.`, field);
}

function assertNotFuture(value: string, today: string, label: string, field?: string): void {
  if (value > today)
    throw new InvalidGenotypingInputError(`${label} cannot be in the future.`, field);
}

/** BR-1: Current or Closed lines can start breeding. */
export function startBreeding(
  line: LineDoc,
  crossDate: string,
  today: string = crossDate,
): LineDoc {
  if (line.status !== 'Current' && line.status !== 'Closed') {
    throw new InvalidTransitionError(line.status, 'Breeding');
  }
  assertIsoDate(crossDate, 'Cross date', 'crossDate');
  assertIsoDate(today, 'Today');
  assertNotFuture(crossDate, today, 'Cross date', 'crossDate');
  return copyLine(line, {
    status: 'Breeding',
    breedingStartedAt: crossDate,
    closedAt: null,
    closedReason: null,
  });
}

/** BR-2: records either accumulate in this generation or register the next generation. */
export function applyGenotyping(line: LineDoc, record: GenotypingInput, today: string): LineDoc {
  assertIsoDate(today, 'Today');
  assertIsoDate(record.recordDate, 'Genotyping date', 'recordDate');
  assertNotFuture(record.recordDate, today, 'Genotyping date', 'recordDate');
  if (!Number.isInteger(record.positiveCount) || record.positiveCount < 0) {
    throw new InvalidGenotypingInputError(
      'Positive number must be a whole number that is zero or greater.',
      'positiveCount',
    );
  }

  if (!record.isNewGeneration) {
    return copyLine(line, {
      idedNumber: line.idedNumber + record.positiveCount,
      lastIdDate: record.recordDate,
    });
  }

  if (line.status !== 'Current' && line.status !== 'Breeding') {
    throw new InvalidTransitionError(line.status, 'Current');
  }
  if (record.newDob === undefined || record.newDob === null || record.newDob === '') {
    throw new InvalidGenotypingInputError('New DOB is required for a new generation.', 'newDob');
  }
  assertIsoDate(record.newDob, 'New DOB', 'newDob');
  assertNotFuture(record.newDob, today, 'New DOB', 'newDob');
  // OQ-31: a new generation may start from Current, as long as the dates stay consistent.
  if (line.dob !== null && record.newDob <= line.dob) {
    throw new InvalidGenotypingInputError(
      "New DOB must be later than the current generation's DOB.",
      'newDob',
    );
  }
  if (record.recordDate < record.newDob) {
    throw new InvalidGenotypingInputError(
      'Genotyping date cannot be before the new DOB.',
      'recordDate',
    );
  }
  return copyLine(line, {
    status: 'Current',
    dob: record.newDob,
    generationNo: line.generationNo + 1,
    idedNumber: record.positiveCount,
    lastIdDate: record.recordDate,
    breedingStartedAt: null,
  });
}

/** BR-1: only an active line can be closed. */
export function closeLine(line: LineDoc, closedAt: string, reason: string | null = null): LineDoc {
  if (line.status !== 'Current' && line.status !== 'Breeding') {
    throw new InvalidTransitionError(line.status, 'Closed');
  }
  assertIsoDate(closedAt, 'Closed date', 'closedAt');
  return copyLine(line, {
    status: 'Closed',
    closedAt,
    closedReason: reason,
    breedingStartedAt: null,
  });
}

/** BR-1: reopening restores a Closed line to Current. */
export function reopenLine(line: LineDoc): LineDoc {
  if (line.status !== 'Closed') throw new InvalidTransitionError(line.status, 'Current');
  return copyLine(line, { status: 'Current', closedAt: null, closedReason: null });
}

export interface BreedingNeed {
  needsBreeding: boolean;
  missingDob: boolean;
  ageMonths: number | null;
}

function calendarParts(
  value: string | Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  if (typeof value === 'string') {
    if (!isIsoDate(value))
      throw new InvalidGenotypingInputError('Date must be a valid YYYY-MM-DD date.');
    return {
      year: Number(value.slice(0, 4)),
      month: Number(value.slice(5, 7)),
      day: Number(value.slice(8, 10)),
    };
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar-month age in the supplied timezone; month-end DOBs age on the last day of shorter months. */
export function ageInMonths(
  dob: string,
  today: string | Date,
  timeZone: string = 'America/New_York',
): number {
  const born = calendarParts(dob, timeZone);
  const current = calendarParts(today, timeZone);
  let months = (current.year - born.year) * 12 + current.month - born.month;
  const anniversaryDay = Math.min(born.day, lastDayOfMonth(current.year, current.month));
  if (current.day < anniversaryDay) months -= 1;
  return Math.max(0, months);
}

/** BR-3: only Current lines with a DOB at or beyond the threshold need breeding. */
export function needsBreeding(
  line: Pick<LineDoc, 'status' | 'dob'>,
  today: string | Date,
  thresholdMonths: number,
  timeZone: string = 'America/New_York',
): BreedingNeed {
  if (line.dob === null) return { needsBreeding: false, missingDob: true, ageMonths: null };
  const ageMonths = ageInMonths(line.dob, today, timeZone);
  return {
    needsBreeding: line.status === 'Current' && ageMonths >= thresholdMonths,
    missingDob: false,
    ageMonths,
  };
}

/**
 * BR-2 display arithmetic: the IDed number after each genotyping record of one generation.
 * `positiveCounts` must be oldest first; entry `i` of the result is the sum of entries `0..i`.
 */
export function runningIdedTotals(positiveCounts: readonly number[]): number[] {
  let total = 0;
  return positiveCounts.map((count) => {
    total += count;
    return total;
  });
}
