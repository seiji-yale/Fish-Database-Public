/**
 * `GET /api/lines/:id` (T-009, FR-LINE-01, FR-ID-01/02, FR-CRYO-01/02, FR-REF-01, FR-HIST-01/04):
 * the Line Detail page's data source. One batch of queries per request (a handful, not per child
 * row — attachments across protocols/genotyping records/references are fetched in a single
 * `owner_id IN (...)` query), assembled by the pure `worker/lib/lineDetail.ts`.
 */
import { Hono } from 'hono';
import { listAttachmentsByIds, listAttachmentsByOwners } from '../db/queries/attachments';
import { listChatMessagesByLine } from '../db/queries/chatMessages';
import { listCryoVialUsesByLine } from '../db/queries/cryoVialUses';
import { listCryoRecordsByLine } from '../db/queries/cryoRecords';
import { listGenotypingRecordsByLine } from '../db/queries/genotypingRecords';
import { listIdProtocolsByLine } from '../db/queries/idProtocols';
import { listLineAttributesByLine } from '../db/queries/lineAttributes';
import { getLineById } from '../db/queries/lines';
import { listLinePhenotypesByLine } from '../db/queries/linePhenotypes';
import { listLineReferencesByLine } from '../db/queries/lineReferences';
import { listLineVersionsByLine } from '../db/queries/lineVersions';
import { listUsers } from '../db/queries/users';
import { buildLineDetail } from '../lib/lineDetail';
import { toLineOverview } from '../../domain/lineOverview';
import { ageInMonths } from '../../domain/breeding';
import { currentProtocols } from '../../domain/currentProtocols';
import { requireCapability, restrictedViewer } from '../lib/permissions';
import { ApiError } from '../lib/errors';
import { buildLineExportCsv, lineExportCsvFileName } from '../lib/lineExport';
import { messages } from '../lib/messages';
import type { Db } from '../db/db';
import type { Bindings } from '../middleware/session';

export const lineDetailRoutes = new Hono<{ Bindings: Bindings }>();

async function loadLineDetail(db: Db, id: string) {
  const line = await getLineById(db, id);
  if (line === null) throw new ApiError(404, 'LINE_NOT_FOUND', messages.lineNotFound);

  const [
    phenotypes,
    attributes,
    protocols,
    cryoRecords,
    cryoUses,
    allCryoRecords,
    references,
    genotypingRecords,
    versions,
    chatMessages,
    users,
  ] = await Promise.all([
    listLinePhenotypesByLine(db, id),
    listLineAttributesByLine(db, id),
    listIdProtocolsByLine(db, id),
    listCryoRecordsByLine(db, id),
    listCryoVialUsesByLine(db, id),
    listCryoRecordsByLine(db, id, { includeDeleted: true }),
    listLineReferencesByLine(db, id),
    listGenotypingRecordsByLine(db, id),
    listLineVersionsByLine(db, id),
    listChatMessagesByLine(db, id),
    listUsers(db, { includeInactive: true }),
  ]);

  const ownerIds = [...protocols.map((row) => row.id), ...genotypingRecords.map((row) => row.id)];
  const referenceAttachmentIds = references
    .map((row) => row.attachment_id)
    .filter((id): id is string => id !== null);
  const [ownedAttachments, referenceAttachments] = await Promise.all([
    listAttachmentsByOwners(db, ownerIds),
    listAttachmentsByIds(db, referenceAttachmentIds),
  ]);
  const attachments = [...ownedAttachments, ...referenceAttachments];
  const userNames = Object.fromEntries(users.map((user) => [user.id, user.name]));

  const document = buildLineDetail({
    line,
    phenotypes,
    attributes,
    protocols,
    cryoRecords,
    cryoUses,
    cryoPlaces: Object.fromEntries(allCryoRecords.map((row) => [row.id, row.place])),
    references,
    genotypingRecords,
    attachments,
    versions,
    chatMessages,
    userNames,
  });

  return document;
}

/** FR-GUEST-07: fetches only what the overview shows, never the records a restricted role must not see. */
async function loadLineOverview(db: Db, id: string) {
  const line = await getLineById(db, id);
  if (line === null) throw new ApiError(404, 'LINE_NOT_FOUND', messages.lineNotFound);
  const [phenotypes, protocols, references] = await Promise.all([
    listLinePhenotypesByLine(db, id),
    listIdProtocolsByLine(db, id),
    listLineReferencesByLine(db, id),
  ]);
  const attachments = await listAttachmentsByIds(
    db,
    references.map((row) => row.attachment_id).filter((value): value is string => value !== null),
  );
  const attachmentById = new Map(attachments.map((row) => [row.id, row]));
  const currentIds = new Set(
    currentProtocols(line.current_protocol_id, protocols).map((row) => row.id),
  );
  return toLineOverview({
    id: line.id,
    name: line.name,
    status: line.status,
    gene: line.gene,
    phenotypes: phenotypes.map((row) => ({ description: row.description })),
    dob: line.dob,
    ageMonths: line.dob === null ? null : ageInMonths(line.dob, new Date()),
    idedNumber: line.ided_number,
    lastIdDate: line.last_id_date,
    protocols: protocols.map((row) => ({
      label: row.label,
      protocolType: row.protocol_type,
      isCurrent: currentIds.has(row.id),
    })),
    references: references.map((row) => {
      const attachment =
        row.attachment_id === null ? undefined : attachmentById.get(row.attachment_id);
      return {
        id: row.id,
        title: row.title,
        url: row.url,
        attachment:
          attachment === undefined ? null : { id: attachment.id, fileName: attachment.file_name },
      };
    }),
  });
}

function todayInLabTimeZone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

lineDetailRoutes.get('/lines/:id', async (c) => {
  const routeId = c.req.param('id');
  if (routeId.endsWith('.csv')) {
    await requireCapability(c, 'lines.export');
    const line = await loadLineDetail(c.env.DB, routeId.slice(0, -4));
    const csv = buildLineExportCsv(line);
    const fileName = lineExportCsvFileName(line.name, todayInLabTimeZone());
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return c.body(csv);
  }
  if ((await restrictedViewer(c)) !== null)
    return c.json(await loadLineOverview(c.env.DB, routeId));
  const document = await loadLineDetail(c.env.DB, routeId);
  c.header('ETag', String(document.version));
  return c.json(document);
});
