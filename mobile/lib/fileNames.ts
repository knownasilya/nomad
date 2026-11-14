// File names for files added to a drive from the phone (components/FileExplorer.tsx).
// Tests: tests/unit/mobile-file-names.test.js.

// `name`, or "name (2).ext" when the folder has one by that name (`taken`: its names, lowercased).
export function freeName (name: string, taken: Set<string>): string {
  const clean = String(name || 'file').replace(/[\\/]/g, '-').trim() || 'file'
  if (!taken.has(clean.toLowerCase())) return clean
  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const ext = dot > 0 ? clean.slice(dot) : ''
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`
    if (!taken.has(next.toLowerCase())) return next
  }
}
