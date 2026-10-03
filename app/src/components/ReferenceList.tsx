/**
 * References section, read view (T-009 Step 4, FR-REF-01, docs/04-ui-spec.md §5.4): icon/type text,
 * title, `Open` link; a reference with neither a URL nor a file shows the amber "Missing link"
 * state (text plus icon, never colour alone). Only http(s) URLs become links.
 */
import type { ReactNode } from 'react';
import { referenceKind, safeExternalUrl, type ReferenceKind } from '../lineDetailFormat';
import type { LineDetailReference } from '../lineDetailApi';
import { strings } from '../strings';
import { attachmentUrl } from './Images';
import { EmptyState } from './shared';

const KIND_LABEL: Record<ReferenceKind, string> = {
  link: strings.referenceKindLink,
  pdf: strings.referenceKindPdf,
  image: strings.referenceKindImage,
  file: strings.referenceKindFile,
};

function ReferenceItem({
  reference,
  actions,
}: {
  reference: LineDetailReference;
  actions?: ReactNode;
}) {
  const url = safeExternalUrl(reference.url);
  const href =
    url ?? (reference.attachment === null ? null : attachmentUrl(reference.attachment.id));
  const kind = referenceKind(url, reference.attachment?.mimeType ?? null);
  return (
    <li className="reference-item">
      <span className="chip" aria-hidden={href === null ? 'true' : undefined}>
        {href === null ? strings.referenceMissingIcon : KIND_LABEL[kind]}
      </span>
      <span className="reference-item__body">
        <strong>{reference.title}</strong>
        {reference.note === null ? null : (
          <span>{`${strings.referenceNote}: ${reference.note}`}</span>
        )}
      </span>
      {href === null ? (
        <span className="reference-item__missing">{strings.referenceMissingLink}</span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${strings.openFile}: ${reference.title}`}
        >
          {strings.openFile}
        </a>
      )}
      {actions}
    </li>
  );
}

export function ReferenceList({
  references,
  renderActions,
}: {
  references: readonly LineDetailReference[];
  /** A row menu (Edit, Remove) for people who may edit. */
  renderActions?: ((reference: LineDetailReference) => ReactNode) | undefined;
}) {
  if (references.length === 0) return <EmptyState />;
  return (
    <ul className="reference-list">
      {references.map((reference) => (
        <ReferenceItem
          key={reference.id}
          reference={reference}
          actions={renderActions?.(reference)}
        />
      ))}
    </ul>
  );
}
