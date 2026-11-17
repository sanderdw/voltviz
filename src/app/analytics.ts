/**
 * Usage events for the Matomo snippet in index.html. Without the snippet (self-hosted builds,
 * development, blocked trackers) there is no queue and nothing is recorded.
 */
type MatomoQueue = { push(command: unknown[]): unknown };

export function trackEvent(category: string, action: string, name?: string): void {
  (window as unknown as { _paq?: MatomoQueue })._paq?.push(['trackEvent', category, action, name]);
}
