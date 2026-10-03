/**
 * Change Activity mutations (T-013, FR-ACT-02…08): each turns a validated payload into a
 * `LineWriteChange` for `withLineWrite`. The transitions and the IDed-number arithmetic are the
 * pure functions in `domain/breeding.ts` (BR-1, BR-2); this file only maps them to table columns
 * and inserts the genotyping record.
 */
import { InvalidGenotypingInputError, InvalidTransitionError } from '../../domain/breeding';
import * as breeding from '../../domain/breeding';
import type { GenotypingActivityInput } from '../../domain/activity';
import type { LineDoc } from '../../domain/types';
import type { Db } from '../db/db';
import { newId } from '../db/ids';
import { insertGenotypingRecordStatement } from '../db/queries/genotypingRecords';
import type { ResolvedAuthor } from '../../domain/types';
import { clearLatestStatements, linkStatement } from './attachmentWrite';
import { ApiError } from './errors';
import type { LineChanges, LineDocument, LineWriteChange } from './lineWrite';
import { messages } from './messages';

export function lineDocOf(document: LineDocument): LineDoc {
  const { line } = document;
  return {
    id: line.id,
    name: line.name,
    status: line.status,
    dob: line.dob,
    generationNo: line.generation_no,
    idedNumber: line.ided_number,
    lastIdDate: line.last_id_date,
    breedingStartedAt: line.breeding_started_at,
    closedAt: line.closed_at,
    closedReason: line.closed_reason,
    version: line.version,
  };
}

/** The `lines` columns that the domain functions may change. */
function columnsOf(after: LineDoc): LineChanges {
  return {
    status: after.status,
    dob: after.dob,
    generation_no: after.generationNo,
    ided_number: after.idedNumber,
    last_id_date: after.lastIdDate,
    breeding_started_at: after.breedingStartedAt,
    closed_at: after.closedAt,
    closed_reason: after.closedReason,
  };
}

/** Domain rule violations become the API's 409 / 400 answers, with field keys for the form. */
export function activityError(error: unknown): unknown {
  if (error instanceof InvalidTransitionError)
    return new ApiError(409, 'INVALID_TRANSITION', error.message);
  if (error instanceof InvalidGenotypingInputError)
    return new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, {
      fields: { [error.field ?? 'form']: error.message },
    });
  return error;
}

export function startBreedingChange(
  before: LineDocument,
  crossDate: string,
  today: string,
): LineWriteChange {
  return { line: columnsOf(breeding.startBreeding(lineDocOf(before), crossDate, today)) };
}

export function closeChange(before: LineDocument, today: string, reason: string | null) {
  return { line: columnsOf(breeding.closeLine(lineDocOf(before), today, reason)) };
}

export function reopenChange(before: LineDocument): LineWriteChange {
  return { line: columnsOf(breeding.reopenLine(lineDocOf(before))) };
}

export function genotypingChange(
  db: Db,
  before: LineDocument,
  input: GenotypingActivityInput,
  author: ResolvedAuthor,
  today: string,
  now: string,
): LineWriteChange {
  if (
    input.protocolId !== null &&
    !before.protocols.some((protocol) => protocol.id === input.protocolId)
  )
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, {
      fields: { protocolId: messages.protocolNotOnLine },
    });
  const after = breeding.applyGenotyping(
    lineDocOf(before),
    {
      recordDate: input.recordDate,
      positiveCount: input.positiveCount,
      isNewGeneration: input.isNewGeneration,
      newDob: input.newDob,
    },
    today,
  );
  const recordId = newId();
  // A gel image uploaded with the record becomes the latest image of the protocol used (T-016).
  const gel =
    input.attachmentId === null
      ? []
      : [
          ...(input.protocolId === null ? [] : clearLatestStatements(db, input.protocolId)),
          linkStatement(db, input.attachmentId, 'genotyping_record', recordId, 'gel_image', true),
        ];
  return {
    line: columnsOf(after),
    statements: [
      insertGenotypingRecordStatement(db, {
        id: recordId,
        line_id: before.line.id,
        generation_no: after.generationNo,
        record_date: input.recordDate,
        protocol_id: input.protocolId,
        positive_count: input.positiveCount,
        screened_count: input.screenedCount,
        is_new_generation: input.isNewGeneration ? 1 : 0,
        new_dob: input.isNewGeneration ? input.newDob : null,
        notes: input.note,
        created_at: now,
        created_by: author.authorId,
      }),
      ...gel,
    ],
    summaryContext: { positiveCount: input.positiveCount },
  };
}
