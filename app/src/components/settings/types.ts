import type { AdminOverview } from '../../adminApi';
import type { useAdminWrite } from '../../useAdminWrite';

/** What every Settings tab receives from the page. */
export interface SectionProps {
  overview: AdminOverview;
  admin: ReturnType<typeof useAdminWrite>;
  /** Reloads the overview after a change. */
  reload: () => void;
}
