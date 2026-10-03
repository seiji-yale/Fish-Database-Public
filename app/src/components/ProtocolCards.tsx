/**
 * ID Protocol read views (T-009 Step 3, FR-ID-01/02/04/06/07, docs/04-ui-spec.md §5.2). One shared
 * body renderer (`ProtocolBody`) feeds both the desktop tabs (one panel, the selected protocol) and
 * the phone stacked cards (all protocols) — the same dual-DOM/CSS-toggle pattern `DataTable`/
 * `CardList` already use, so this file never has two copies of the per-type field logic.
 */
import { type ReactNode, useState } from 'react';
import { EmptyState, Field, Toast } from './shared';
import { strings } from '../strings';
import type { LineDetailAttachment, LineDetailProtocol } from '../lineDetailApi';
import { safeExternalUrl } from '../lineDetailFormat';
import { AttachmentImages } from './Images';

function str(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  return typeof value === 'number' ? value : null;
}

function customItems(fields: Record<string, unknown>): { key: string; value: string }[] {
  const value = fields['items'];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is { key: string; value: string } =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>)['key'] === 'string' &&
      typeof (entry as Record<string, unknown>)['value'] === 'string',
  );
}

function sequenceResultUrls(fields: Record<string, unknown>): string[] {
  const value = fields['seq_result_urls'];
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string') : [];
}

/** A monospace, uppercase sequence (FR-ID-08) with a copy button; a successful copy announces
 * itself via `Toast` (`role="status"`), satisfying "copy button announces success" without a
 * bespoke live region. The copied text is the uppercase text shown. */
function SequenceField({ label, value: stored }: { label: string; value: string }) {
  const value = stored.toUpperCase();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* Clipboard permission denied or unavailable: nothing useful to announce. */
    }
  }

  return (
    <div className="sequence-field">
      <strong className="sequence-field__label">{label}</strong>
      <div className="sequence-field__content">
        <code className="sequence-field__value">{value}</code>
        <button
          type="button"
          className="sequence-field__copy"
          aria-label={strings.copyAria(label)}
          onClick={() => {
            void copy();
          }}
        >
          {strings.copy}
        </button>
      </div>
      {copied ? (
        <Toast
          message={strings.copiedToClipboard}
          onClose={() => {
            setCopied(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PcrFields({ fields }: { fields: Record<string, unknown> }) {
  const forwardName = str(fields, 'primer_f_name');
  const forwardSeq = str(fields, 'primer_f_seq');
  const reverseName = str(fields, 'primer_r_name');
  const reverseSeq = str(fields, 'primer_r_seq');
  const annealing = num(fields, 'annealing_c');
  const band = str(fields, 'expected_band');
  const cycles = num(fields, 'cycles');
  return (
    <>
      {forwardSeq !== null ? (
        <SequenceField
          label={`${strings.primerForward}${forwardName === null ? '' : ` (${forwardName})`}`}
          value={forwardSeq}
        />
      ) : null}
      {reverseSeq !== null ? (
        <SequenceField
          label={`${strings.primerReverse}${reverseName === null ? '' : ` (${reverseName})`}`}
          value={reverseSeq}
        />
      ) : null}
      {annealing !== null ? (
        <Field label={strings.annealingTemperature}>{strings.degreesCelsius(annealing)}</Field>
      ) : null}
      {cycles !== null ? <Field label={strings.cyclesLabel}>{cycles}</Field> : null}
      {band !== null ? <Field label={strings.expectedBandSize}>{band}</Field> : null}
    </>
  );
}

function PcrSequenceExtraFields({ fields }: { fields: Record<string, unknown> }) {
  const sequencingPrimer = str(fields, 'seq_primer');
  const guideSeq = str(fields, 'guide_seq');
  const mutation = str(fields, 'expected_mutation');
  const resultUrls = sequenceResultUrls(fields);
  return (
    <>
      {sequencingPrimer !== null ? (
        <Field label={strings.sequencingPrimer}>{sequencingPrimer}</Field>
      ) : null}
      {guideSeq !== null ? <SequenceField label={strings.guideSequence} value={guideSeq} /> : null}
      {mutation !== null ? (
        <Field label={strings.expectedMutation}>
          <code>{mutation}</code>
        </Field>
      ) : null}
      {resultUrls.length > 0 ? (
        <div className="detail-field detail-field--block">
          <strong>{strings.sequenceResults}</strong>
          <ul className="attribute-list">
            {resultUrls.map((url) => {
              // Only http(s) URLs are links: a stored `javascript:` URL is shown as plain text.
              const safe = safeExternalUrl(url);
              return (
                <li key={url}>
                  {safe === null ? (
                    url
                  ) : (
                    <a href={safe} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function FluorescenceFields({ fields }: { fields: Record<string, unknown> }) {
  const fluorophore = str(fields, 'fluorophore');
  const screeningDay = str(fields, 'screening_day');
  const description = str(fields, 'description');
  return (
    <>
      {fluorophore !== null ? <Field label={strings.fluorophoreLabel}>{fluorophore}</Field> : null}
      {screeningDay !== null ? (
        <Field label={strings.screeningDay}>{strings.daysPostFertilisation(screeningDay)}</Field>
      ) : null}
      {description !== null ? <Field label={strings.descriptionLabel}>{description}</Field> : null}
    </>
  );
}

function CustomFields({ fields }: { fields: Record<string, unknown> }) {
  const rows = customItems(fields);
  if (rows.length === 0) return null;
  return (
    <div className="detail-field detail-field--block">
      <strong>{strings.customFields}</strong>
      <ul className="attribute-list">
        {rows.map((row, index) => (
          <li key={`${row.key}-${String(index)}`}>{`${row.key}: ${row.value}`}</li>
        ))}
      </ul>
    </div>
  );
}

/** `none`/`tails` have no template fields (FR-ID-06): notes only, handled by the shared trailer
 * below rather than a dedicated component. */
function ProtocolBody({
  protocol,
  actions,
  onRemoveImage,
  renderUpload,
}: {
  protocol: LineDetailProtocol;
  actions: ReactNode;
  renderUpload?: ((hasImages: boolean) => ReactNode) | undefined;
  onRemoveImage?: ((attachment: LineDetailAttachment) => void) | undefined;
}) {
  return (
    <div className="protocol-fields">
      {protocol.protocolType === 'pcr' ? <PcrFields fields={protocol.fields} /> : null}
      {protocol.protocolType === 'pcr_sequence' ? (
        <>
          <PcrFields fields={protocol.fields} />
          <PcrSequenceExtraFields fields={protocol.fields} />
        </>
      ) : null}
      {protocol.protocolType === 'fluorescence' ? (
        <FluorescenceFields fields={protocol.fields} />
      ) : null}
      {protocol.protocolType === 'custom' ? <CustomFields fields={protocol.fields} /> : null}
      {protocol.notes !== null ? <Field label={strings.columnNotes}>{protocol.notes}</Field> : null}
      <AttachmentImages
        attachments={protocol.attachments}
        showEmptyHint={protocol.protocolType !== 'none' && protocol.protocolType !== 'tails'}
        onRemove={onRemoveImage}
        uploader={renderUpload}
      />
      {actions}
    </div>
  );
}

function ProtocolTabLabel({ protocol }: { protocol: LineDetailProtocol }) {
  return (
    <>
      {protocol.label}
      {protocol.isCurrent ? <span className="chip">{strings.current}</span> : null}
    </>
  );
}

export function ProtocolsSection({
  protocols,
  renderActions,
  onRemoveImage,
  renderUpload,
}: {
  protocols: readonly LineDetailProtocol[];
  /** The upload control under a protocol's images (an "Upload another image" button), for editors. */
  renderUpload?: ((protocol: LineDetailProtocol, hasImages: boolean) => ReactNode) | undefined;
  /** Given to people who may edit: a "Remove image" button under each image. */
  onRemoveImage?: ((attachment: LineDetailAttachment) => void) | undefined;
  /** Card footer (Edit, Set as current, ...); omitted for read-only views. */
  renderActions?:
    ((protocol: LineDetailProtocol, index: number, count: number) => ReactNode) | undefined;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(protocols[0]?.id ?? null);
  if (protocols.length === 0) return <EmptyState />;
  const selected = protocols.find((protocol) => protocol.id === selectedId) ?? protocols[0];
  return (
    <>
      <div className="protocol-tabs" role="tablist" aria-label={strings.sectionIdProtocols}>
        {protocols.map((protocol) => (
          <button
            key={protocol.id}
            type="button"
            role="tab"
            aria-selected={protocol.id === selected?.id}
            className={protocol.id === selected?.id ? 'is-selected' : ''}
            onClick={() => {
              setSelectedId(protocol.id);
            }}
          >
            <ProtocolTabLabel protocol={protocol} />
          </button>
        ))}
      </div>
      <div className="protocol-tab-panel" role="tabpanel">
        {selected === undefined ? null : (
          <ProtocolBody
            protocol={selected}
            actions={renderActions?.(selected, protocols.indexOf(selected), protocols.length)}
            onRemoveImage={onRemoveImage}
            renderUpload={
              renderUpload === undefined
                ? undefined
                : (hasImages) => renderUpload(selected, hasImages)
            }
          />
        )}
      </div>
      <div className="protocol-card-list">
        {protocols.map((protocol, index) => (
          <article className="data-card" key={protocol.id}>
            {/* Phone: only the current methods are open; the others fold away to keep the page short. */}
            <details className="protocol-card" open={protocol.isCurrent}>
              <summary>
                <strong>
                  <ProtocolTabLabel protocol={protocol} />
                </strong>
              </summary>
              <ProtocolBody
                protocol={protocol}
                actions={renderActions?.(protocol, index, protocols.length)}
                onRemoveImage={onRemoveImage}
                renderUpload={
                  renderUpload === undefined
                    ? undefined
                    : (hasImages) => renderUpload(protocol, hasImages)
                }
              />
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
