/**
 * The overview shapes restricted roles (Guest, Feeder) receive instead of the full Line List row and
 * Line Detail document (docs/08 FR-GUEST-05/07, ADR-0006, BR-15). Both functions build the result
 * field by field from an allow-list: a field added to the full shapes later never reaches a
 * restricted role unless it is added here on purpose.
 */
import { PROTOCOL_TYPE_LABELS, type NewLineProtocolType } from './newLine';
import type { LineStatus } from './types';

export interface OverviewReference {
  id: string;
  title: string;
  url: string | null;
  hasAttachment: boolean;
}

/** A reference on the Line Detail overview: carries the file id so `Open` works for Guests. */
export interface OverviewDetailReference extends OverviewReference {
  attachmentId: string | null;
  fileName: string | null;
}

export interface LineListOverviewSource {
  id: string;
  name: string;
  gene: string | null;
  phenotypes: readonly string[];
  dob: string | null;
  ageMonths: number | null;
  status: LineStatus;
  idMethod: string;
  idMethodTypes: readonly NewLineProtocolType[];
  lastIdDate: string | null;
  idedNumber: number;
  missingDob: boolean;
  references: readonly OverviewReference[];
}

export interface LineListOverview {
  id: string;
  name: string;
  gene: string | null;
  phenotypes: string[];
  dob: string | null;
  ageMonths: number | null;
  status: LineStatus;
  idMethod: string;
  idMethodTypes: NewLineProtocolType[];
  lastIdDate: string | null;
  idedNumber: number;
  missingDob: boolean;
  references: OverviewReference[];
}

export function toLineListOverview(item: LineListOverviewSource): LineListOverview {
  return {
    id: item.id,
    name: item.name,
    gene: item.gene,
    phenotypes: [...item.phenotypes],
    dob: item.dob,
    ageMonths: item.ageMonths,
    status: item.status,
    idMethod: item.idMethod,
    idMethodTypes: [...item.idMethodTypes],
    lastIdDate: item.lastIdDate,
    idedNumber: item.idedNumber,
    missingDob: item.missingDob,
    references: item.references.map(toReference),
  };
}

function toReference(reference: OverviewReference): OverviewReference {
  return {
    id: reference.id,
    title: reference.title,
    url: reference.url,
    hasAttachment: reference.hasAttachment,
  };
}

export interface LineOverviewSource {
  id: string;
  name: string;
  status: LineStatus;
  gene: string | null;
  phenotypes: readonly { description: string }[];
  dob: string | null;
  ageMonths: number | null;
  idedNumber: number;
  lastIdDate: string | null;
  protocols: readonly { label: string; protocolType: NewLineProtocolType; isCurrent: boolean }[];
  references: readonly {
    id: string;
    title: string;
    url: string | null;
    attachment: { id: string; fileName: string | null } | null;
  }[];
}

export interface LineOverview {
  restricted: true;
  id: string;
  name: string;
  status: LineStatus;
  gene: string | null;
  phenotypes: string[];
  dob: string | null;
  ageMonths: number | null;
  idedNumber: number;
  lastIdDate: string | null;
  idMethods: { label: string; typeName: string }[];
  references: OverviewDetailReference[];
}

/** Label and type name of each current protocol, nothing else of the protocol (FR-GUEST-07). */
export function toLineOverview(line: LineOverviewSource): LineOverview {
  return {
    restricted: true,
    id: line.id,
    name: line.name,
    status: line.status,
    gene: line.gene,
    phenotypes: line.phenotypes.map((phenotype) => phenotype.description),
    dob: line.dob,
    ageMonths: line.ageMonths,
    idedNumber: line.idedNumber,
    lastIdDate: line.lastIdDate,
    idMethods: line.protocols
      .filter((protocol) => protocol.isCurrent)
      .map((protocol) => ({
        label: protocol.label,
        typeName: PROTOCOL_TYPE_LABELS[protocol.protocolType],
      })),
    references: line.references.map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      hasAttachment: reference.attachment !== null,
      attachmentId: reference.attachment?.id ?? null,
      fileName: reference.attachment?.fileName ?? null,
    })),
  };
}
