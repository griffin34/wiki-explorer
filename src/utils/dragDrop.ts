// ── Outlook / cross-app drag-and-drop helpers ─────────────────────────────────
// react-dropzone only activates when 'Files' appears in dataTransfer.types.
// Outlook on Mac omits this for dragged emails, so we bypass it with native
// events and a multi-method file extraction approach.

export interface DropSnapshot {
  stdFiles: File[]
  itemFiles: File[]
  entries: FileSystemFileEntry[]
  plainText: string
}

/** Synchronously snapshot everything from a DataTransfer before it clears. */
export function snapshotDrop(dt: DataTransfer): DropSnapshot {
  return {
    stdFiles: Array.from(dt.files),
    itemFiles: Array.from(dt.items)
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null),
    entries: Array.from(dt.items)
      .filter((i) => i.kind === 'file')
      .map((i) => (i as DataTransferItem & { webkitGetAsEntry?(): FileSystemEntry | null }).webkitGetAsEntry?.())
      .filter((e): e is FileSystemFileEntry => e?.isFile === true),
    plainText: (() => { try { return dt.getData('text/plain') } catch { return '' } })(),
  }
}

/** Resolve a snapshot to File objects. Async only for webkitGetAsEntry resolution. */
export async function resolveDropSnapshot(snap: DropSnapshot): Promise<File[]> {
  // 1. Standard files (most drag sources)
  if (snap.stdFiles.length > 0) return snap.stdFiles

  // 2. items.getAsFile() — works when .files is inexplicably empty
  if (snap.itemFiles.length > 0) return snap.itemFiles

  // 3. webkitGetAsEntry async resolution — macOS promised files (Outlook .eml)
  if (snap.entries.length > 0) {
    const resolved = await Promise.all(
      snap.entries.map((e) => new Promise<File | null>((ok) => e.file(ok, () => ok(null))))
    )
    const entryFiles = resolved.filter((f): f is File => f !== null)
    if (entryFiles.length > 0) return entryFiles
  }

  // 4. Email body text — Outlook may not expose a file at all, but does populate
  //    text/plain with the email body. Save it as a timestamped .txt file.
  if (snap.plainText.trim()) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    return [new File([snap.plainText], `email-${ts}.txt`, { type: 'text/plain' })]
  }

  return []
}
