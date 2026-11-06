// The phone's copy of the Space name and color rules in shared/space-records.mjs (the Bare
// backend checks with that file too). tests/unit/space-records.test.js keeps the two equal.

// Desktop's 8-color palette (app/fg/shell-menus/spaces.js).
export const SPACE_COLORS = [
  '#6c6cff', '#e85d4a', '#e8a025', '#3ab36e',
  '#2b9fd4', '#9b59b6', '#e91e8c', '#607d8b'
]

// The longest name a Space takes.
export const SPACE_NAME_MAX = 60

// A name the user typed, tidied: trimmed, inner runs of space made one, capped. '' when empty.
export function cleanSpaceName (name: string): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, SPACE_NAME_MAX).trim()
}
