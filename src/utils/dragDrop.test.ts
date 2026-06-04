import { describe, it, expect, vi } from 'vitest'
import { snapshotDrop, resolveDropSnapshot, type DropSnapshot } from './dragDrop'

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeFile(name: string, content = 'hello'): File {
  return new File([content], name, { type: 'text/plain' })
}

/** Build a minimal DataTransferItem with getAsFile + optional webkitGetAsEntry. */
function makeItem(file: File | null, entry?: FileSystemFileEntry): DataTransferItem {
  return {
    kind: 'file',
    type: file?.type ?? 'text/plain',
    getAsFile: () => file,
    getAsString: () => {},
    webkitGetAsEntry: entry ? () => entry : undefined,
  } as unknown as DataTransferItem
}

/** Build a minimal FileSystemFileEntry whose file() resolves to the given File. */
function makeEntry(file: File): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (success: (f: File) => void) => success(file),
  } as unknown as FileSystemFileEntry
}

/** Build a minimal FileSystemFileEntry whose file() rejects. */
function makeFailingEntry(): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: 'bad.eml',
    file: (_: unknown, err: () => void) => err(),
  } as unknown as FileSystemFileEntry
}

/** Build a fake DataTransfer with explicit files, items, and text data. */
function makeDT({
  files = [] as File[],
  items = [] as DataTransferItem[],
  plain = '',
}: {
  files?: File[]
  items?: DataTransferItem[]
  plain?: string
}): DataTransfer {
  return {
    files: { length: files.length, item: (i: number) => files[i], [Symbol.iterator]: files[Symbol.iterator].bind(files) } as unknown as FileList,
    items: { length: items.length, [Symbol.iterator]: items[Symbol.iterator].bind(items) } as unknown as DataTransferItemList,
    getData: (type: string) => (type === 'text/plain' ? plain : ''),
    // other members not needed by our code
  } as unknown as DataTransfer
}

// ── snapshotDrop ──────────────────────────────────────────────────────────────

describe('snapshotDrop', () => {
  it('captures stdFiles from DataTransfer.files', () => {
    const f = makeFile('report.pdf')
    const dt = makeDT({ files: [f] })
    const snap = snapshotDrop(dt)
    expect(snap.stdFiles).toHaveLength(1)
    expect(snap.stdFiles[0].name).toBe('report.pdf')
  })

  it('captures itemFiles from DataTransfer.items', () => {
    const f = makeFile('attachment.docx')
    const dt = makeDT({ items: [makeItem(f)] })
    const snap = snapshotDrop(dt)
    expect(snap.itemFiles).toHaveLength(1)
    expect(snap.itemFiles[0].name).toBe('attachment.docx')
  })

  it('captures FileSystemFileEntries via webkitGetAsEntry', () => {
    const f = makeFile('email.eml')
    const entry = makeEntry(f)
    const dt = makeDT({ items: [makeItem(null, entry)] })
    const snap = snapshotDrop(dt)
    expect(snap.entries).toHaveLength(1)
    expect(snap.entries[0].name).toBe('email.eml')
  })

  it('ignores items that are not kind=file', () => {
    const stringItem = { kind: 'string', type: 'text/plain', getAsFile: () => null } as unknown as DataTransferItem
    const dt = makeDT({ items: [stringItem] })
    const snap = snapshotDrop(dt)
    expect(snap.itemFiles).toHaveLength(0)
    expect(snap.entries).toHaveLength(0)
  })

  it('captures plain text from getData', () => {
    const dt = makeDT({ plain: 'Hello from Outlook' })
    const snap = snapshotDrop(dt)
    expect(snap.plainText).toBe('Hello from Outlook')
  })

  it('returns empty plainText when getData throws', () => {
    const dt = { ...makeDT({}), getData: () => { throw new Error('not allowed') } } as unknown as DataTransfer
    const snap = snapshotDrop(dt)
    expect(snap.plainText).toBe('')
  })
})

// ── resolveDropSnapshot ───────────────────────────────────────────────────────

describe('resolveDropSnapshot', () => {
  const empty: DropSnapshot = { stdFiles: [], itemFiles: [], entries: [], plainText: '' }

  it('returns stdFiles when present (highest priority)', async () => {
    const f = makeFile('doc.pdf')
    const snap: DropSnapshot = { ...empty, stdFiles: [f], itemFiles: [makeFile('other.txt')] }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('doc.pdf')
  })

  it('falls back to itemFiles when stdFiles is empty', async () => {
    const f = makeFile('attachment.docx')
    const snap: DropSnapshot = { ...empty, itemFiles: [f] }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('attachment.docx')
  })

  it('resolves webkitGetAsEntry entries asynchronously', async () => {
    const f = makeFile('email.eml', '# Email content')
    const snap: DropSnapshot = { ...empty, entries: [makeEntry(f)] }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('email.eml')
  })

  it('skips failing entries and returns remaining resolved ones', async () => {
    const good = makeFile('good.eml')
    const snap: DropSnapshot = { ...empty, entries: [makeFailingEntry(), makeEntry(good)] }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('good.eml')
  })

  it('falls back to a synthetic txt file from plainText', async () => {
    const snap: DropSnapshot = { ...empty, plainText: 'Meeting notes from Outlook' }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toMatch(/^email-.*\.txt$/)
    expect(result[0].type).toBe('text/plain')
    const text = await result[0].text()
    expect(text).toBe('Meeting notes from Outlook')
  })

  it('ignores whitespace-only plainText', async () => {
    const snap: DropSnapshot = { ...empty, plainText: '   \n\t  ' }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when nothing is available', async () => {
    const result = await resolveDropSnapshot(empty)
    expect(result).toHaveLength(0)
  })

  it('does not use plainText when entries succeed', async () => {
    const f = makeFile('real.eml')
    const snap: DropSnapshot = { ...empty, entries: [makeEntry(f)], plainText: 'fallback text' }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('real.eml')
  })

  it('falls back to plainText when all entries fail to resolve', async () => {
    const snap: DropSnapshot = { ...empty, entries: [makeFailingEntry()], plainText: 'recovered text' }
    const result = await resolveDropSnapshot(snap)
    expect(result).toHaveLength(1)
    expect(result[0].name).toMatch(/^email-.*\.txt$/)
    const text = await result[0].text()
    expect(text).toBe('recovered text')
  })
})
