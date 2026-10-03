export const DEFAULT_APP_NAME = 'The Lab Fish Database';

export function appDisplayName(configured: string | undefined): string {
  return configured?.trim() || DEFAULT_APP_NAME;
}
