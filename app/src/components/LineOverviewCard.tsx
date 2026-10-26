/** Line Detail for Guests and Feeders (FR-GUEST-08): the summary card and the references, nothing else. */
import { formatDate } from '../dateFormat';
import type { LineOverviewDocument } from '../lineDetailApi';
import { safeExternalUrl } from '../lineDetailFormat';
import { linesReturnUrl } from '../linesReturn';
import { strings } from '../strings';
import { IconLink } from './Icons';
import { attachmentUrl } from './Images';
import { Field, StatusBadge } from './shared';

export function LineOverviewCard({ line, hint }: { line: LineOverviewDocument; hint: string }) {
  const methods = line.idMethods.map((method) => method.label).join(', ');
  return (
    <section className="line-detail-page line-overview">
      <a className="back-to-lines" href={linesReturnUrl()}>
        <span aria-hidden="true">{strings.backToLinesIcon}</span> {strings.backToLines}
      </a>
      <section id="summary" className="detail-section">
        <header className="detail-title">
          <h1>{line.name}</h1>
          <StatusBadge status={line.status} />
          <span>{`${strings.gene}: ${line.gene ?? strings.emptyValue}`}</span>
        </header>
        <div className="detail-grid">
          <Field label={strings.dob}>
            {line.dob === null ? strings.emptyValue : formatDate(line.dob)}
          </Field>
          <Field label={strings.age}>
            {line.ageMonths === null ? strings.emptyValue : strings.ageMonths(line.ageMonths)}
          </Field>
          <Field label={strings.idedNumber}>{line.idedNumber}</Field>
          <Field label={strings.lastIdDate}>
            {line.lastIdDate === null ? strings.emptyValue : formatDate(line.lastIdDate)}
          </Field>
          <Field label={strings.currentIdMethod}>
            {methods === '' ? strings.idMethodNone : methods}
          </Field>
        </div>
        <div className="detail-field detail-field--block">
          <strong>{strings.phenotypes}</strong>
          {line.phenotypes.length === 0 ? (
            <span>{strings.emptyValue}</span>
          ) : (
            <span className="chip-row">
              {line.phenotypes.map((phenotype) => (
                <span className="chip" key={phenotype}>
                  {phenotype}
                </span>
              ))}
            </span>
          )}
        </div>
      </section>
      <section id="refs" className="detail-section">
        <h2>{strings.references}</h2>
        {line.references.length === 0 ? (
          <p>{strings.emptyValue}</p>
        ) : (
          <ul className="reference-list">
            {line.references.map((reference) => {
              const url = safeExternalUrl(reference.url);
              const href =
                url ??
                (reference.attachmentId === null ? null : attachmentUrl(reference.attachmentId));
              const openLabel = url === null ? strings.downloadFile : strings.openFile;
              return (
                <li className="reference-item" key={reference.id}>
                  <span className="reference-item__body">
                    <strong>{reference.title}</strong>
                    {reference.fileName === null ||
                    reference.fileName === reference.title ? null : (
                      <span className="reference-item__file">{reference.fileName}</span>
                    )}
                  </span>
                  {href === null ? (
                    <span className="reference-item__missing">{strings.referenceMissingLink}</span>
                  ) : (
                    <IconLink
                      icon={url === null ? 'download' : 'open'}
                      label={`${openLabel}: ${reference.title}`}
                      href={href}
                      newTab
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="overview-hint">{hint}</p>
    </section>
  );
}
