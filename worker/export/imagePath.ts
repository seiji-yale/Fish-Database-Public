/**
 * Where an image lives in the Dropbox copy (docs/06-operations.md §1.2), shared by the mirror
 * (which uploads it) and `snapshot.html` (which links to it).
 */
import { safeFileName } from '../../domain/attachments';

/**
 * `<line name>/<attachment id>-<file name>` below `images/`. The R2 key is
 * `lines/<line id>/<attachment id>-<safe file name>`; a `/` in a line name would make a sub-folder.
 */
export function mirrorImagePath(lineName: string, attachmentId: string, r2Key: string): string {
  const [, , fileName = attachmentId] = r2Key.split('/');
  return `${safeFileName(lineName.replaceAll('/', '-'))}/${fileName}`;
}
