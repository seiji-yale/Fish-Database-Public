import { useEffect, useState } from 'react';
import { HttpError } from '../api';
import { formatDate, formatDateTime } from '../dateFormat';
import { getLineDetail, type LineDetailDocument } from '../lineDetailApi';
import { strings } from '../strings';
import { attachmentUrl } from '../components/Images';

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    primer_f_name: 'Forward primer name',
    primer_f_seq: 'Forward primer sequence',
    primer_r_name: 'Reverse primer name',
    primer_r_seq: 'Reverse primer sequence',
    annealing_c: 'Annealing temperature (°C)',
    expected_band: 'Expected band size',
    cycles: 'Cycles',
    seq_primer: 'Sequencing primer',
    guide_seq: 'Guide sequence',
    expected_mutation: 'Expected mutation',
    seq_result_urls: 'Sequence results',
    fluorophore: 'Fluorophore',
    screening_day: 'Screening day',
    description: 'Description',
    items: 'Custom fields',
  };
  return labels[key] ?? key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value))
    return value
      .map((item) =>
        item !== null && typeof item === 'object'
          ? Object.entries(item as Record<string, unknown>)
              .map(([key, entry]) => `${fieldLabel(key)}: ${fieldValue(entry)}`)
              .join(' · ')
          : fieldValue(item),
      )
      .join('; ');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? strings.yes : strings.no;
  return strings.emptyValue;
}

function PrintView({ line, generatedAt }: { line: LineDetailDocument; generatedAt: string }) {
  const protocols = [...line.protocols].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  const cryoRows = line.cryoRecords;
  const references = line.references;
  const history = [...line.versions].sort((a, b) => b.versionNo - a.versionNo).slice(0, 20);
  return (
    <main className="print-view">
      <header className="print-header">
        <p>{strings.appName}</p>
        <h1>{line.name}</h1>
        <p>{`${strings.status}: ${line.status}`}</p>
      </header>
      <section className="print-section">
        <h2>{strings.sectionSummary}</h2>
        <dl className="print-grid">
          <div>
            <dt>{strings.gene}</dt>
            <dd>{line.gene ?? strings.emptyValue}</dd>
          </div>
          <div>
            <dt>{strings.dob}</dt>
            <dd>{line.dob === null ? strings.emptyValue : formatDate(line.dob)}</dd>
          </div>
          <div>
            <dt>{strings.idedNumber}</dt>
            <dd>{line.idedNumber}</dd>
          </div>
          <div>
            <dt>{strings.lastIdDate}</dt>
            <dd>{line.lastIdDate === null ? strings.emptyValue : formatDate(line.lastIdDate)}</dd>
          </div>
          <div>
            <dt>{strings.phenotypes}</dt>
            <dd>
              {line.phenotypes.map((item) => item.description).join('; ') || strings.emptyValue}
            </dd>
          </div>
          <div>
            <dt>{strings.columnNotes}</dt>
            <dd>{line.notes ?? strings.emptyValue}</dd>
          </div>
          <div>
            <dt>{strings.moreAttributes}</dt>
            <dd>
              {line.attributes
                .map((item) => `${item.key}: ${item.value ?? strings.emptyValue}`)
                .join('; ') || strings.emptyValue}
            </dd>
          </div>
        </dl>
      </section>
      <section className="print-section">
        <h2>{strings.sectionIdProtocols}</h2>
        {protocols.length === 0 ? (
          <p>{strings.empty}</p>
        ) : (
          protocols.map((protocol) => (
            <article className="print-card" key={protocol.id}>
              <h3>
                {protocol.label}
                {protocol.isCurrent ? ` · ${strings.current}` : ''}
              </h3>
              <dl className="print-grid">
                {Object.entries(protocol.fields).map(([key, value]) => (
                  <div className={/seq|mutation/i.test(key) ? 'print-sequence' : ''} key={key}>
                    <dt>{fieldLabel(key)}</dt>
                    <dd>{fieldValue(value)}</dd>
                  </div>
                ))}
                {protocol.notes === null ? null : (
                  <div>
                    <dt>{strings.columnNotes}</dt>
                    <dd>{protocol.notes}</dd>
                  </div>
                )}
              </dl>
              {protocol.attachments.length === 0 ? null : (
                <div className="print-images">
                  {protocol.attachments.map((attachment) => (
                    <figure key={attachment.id}>
                      <img
                        src={attachmentUrl(attachment.id)}
                        alt={
                          attachment.caption ?? attachment.fileName ?? strings.sectionIdProtocols
                        }
                      />
                      <figcaption>{attachment.caption ?? attachment.fileName}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </article>
          ))
        )}
      </section>
      <section className="print-section">
        <h2>{strings.sectionCryopreservation}</h2>
        {cryoRows.length === 0 ? (
          <p>{strings.cryoNone}</p>
        ) : (
          cryoRows.map((record) => (
            <article className="print-card" key={record.id}>
              <p>
                <strong>
                  {record.detailsUnknown
                    ? strings.detailsUnknown
                    : record.cryoDate === null
                      ? strings.emptyValue
                      : formatDate(record.cryoDate)}
                </strong>
              </p>
              <p>
                {[
                  record.place,
                  record.boxName,
                  [record.cryoIdStart, record.cryoIdEnd].filter(Boolean).join('–'),
                  record.count === null ? null : `Count: ${String(record.count)}`,
                  record.notes,
                ]
                  .filter(Boolean)
                  .join(' · ') || strings.emptyValue}
              </p>
            </article>
          ))
        )}
      </section>
      <section className="print-section">
        <h2>{strings.references}</h2>
        {references.length === 0 ? (
          <p>{strings.empty}</p>
        ) : (
          <ul>
            {references.map((reference) => (
              <li key={reference.id}>
                <strong>{reference.title}</strong>
                {reference.url === null ? '' : ` — ${reference.url}`}
                {reference.note === null ? '' : ` (${reference.note})`}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="print-section">
        <h2>{strings.history}</h2>
        {history.length === 0 ? (
          <p>{strings.empty}</p>
        ) : (
          <ol>
            {history.map((version) => (
              <li key={version.id}>
                {`${formatDateTime(version.createdAt)} · ${version.createdByName} · ${version.summary}`}
                {version.note === null ? '' : ` — ${version.note}`}
              </li>
            ))}
          </ol>
        )}
      </section>
      <footer className="print-footer">
        <span>{window.location.origin}</span>
        <span>{`${strings.generatedAt}: ${formatDateTime(generatedAt)}`}</span>
      </footer>
    </main>
  );
}

export function PrintPage({ id }: { id: string }) {
  const [line, setLine] = useState<LineDetailDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    getLineDetail(id)
      .then((document) => {
        if (!cancelled) setLine(document);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof HttpError && cause.status === 404
            ? strings.lineNotFound
            : strings.requestFailed,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (line !== null) window.print();
  }, [line]);

  if (error !== null)
    return (
      <main className="print-view">
        <p role="alert">{error}</p>
      </main>
    );
  return line === null ? (
    <main className="print-view">
      <p>{strings.loading}</p>
    </main>
  ) : (
    <PrintView line={line} generatedAt={generatedAt} />
  );
}
