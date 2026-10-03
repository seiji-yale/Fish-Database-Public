import {
  CardList,
  DataTable,
  EmptyState,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  Toast,
} from './components/shared';
import { strings } from './strings';
const sampleRows = [{ id: 'demo_c3', line: 'demo_c3', status: strings.current, idedNumber: 6 }];
export function StyleGuide() {
  const columns = [
    { key: 'line' as const, label: strings.lines },
    { key: 'status' as const, label: strings.status },
    { key: 'idedNumber' as const, label: strings.idedNumber },
  ];
  return (
    <section className="style-guide">
      <h1>{strings.styleGuide}</h1>
      <section>
        <h2>{strings.status}</h2>
        <div className="badge-row">
          <StatusBadge status="Current" />
          <StatusBadge status="Breeding" />
          <StatusBadge status="Closed" />
        </div>
      </section>
      <section>
        <h2>{strings.dashboard}</h2>
        <button className="button--primary" type="button">
          {strings.save}
        </button>
        <SegmentedControl
          label={strings.lines}
          options={[strings.current, strings.closed]}
          value={strings.current}
          onChange={() => undefined}
        />
      </section>
      <section>
        <h2>{strings.lines}</h2>
        <DataTable columns={columns} rows={sampleRows} />
        <CardList columns={[{ key: 'line', label: strings.lines }]} rows={sampleRows} />
      </section>
      <EmptyState />
      <Skeleton />
      <Toast message={strings.breedSoon} onClose={() => undefined} />
    </section>
  );
}
