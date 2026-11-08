// Links from outside the app (expo-router's native intent hook). An invite link (ADR-0040) opens
// the browser screen, which reads it with Linking and opens the Space switcher's join form
// (app/index.tsx), so the router never tries to treat the invite's payload as a route.
export function redirectSystemPath ({ path }: { path: string; initial: boolean }) {
  if (/^nomad-invite:|\/invite\/?#/i.test(path || '')) return '/'
  return path
}
