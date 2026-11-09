// Links from outside the app (expo-router's native intent hook). An invite link (ADR-0040) and a
// tap on the home screen search widget (nomad-widget://, lib/widgetLinks.ts) open the browser
// screen, which reads them with Linking, so the router never tries to treat them as routes.
export function redirectSystemPath ({ path }: { path: string; initial: boolean }) {
  if (/^nomad-invite:|\/invite\/?#|^nomad-widget:/i.test(path || '')) return '/'
  return path
}
