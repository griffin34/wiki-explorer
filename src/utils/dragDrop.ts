// ── Outlook / cross-app drag-and-drop helpers ─────────────────────────────────
// react-dropzone only activates when 'Files' appears in dataTransfer.types.
// Outlook on Mac omits this for dragged emails, so we bypass it with native
// events and a multi-method file extraction approach.

export interface DropSnapshot {
  stdFiles: File[]
  itemFiles: File[]
  entries: FileSystemFileEntry[]
  plainText: string
  htmlText: string
  /** Outlook-specific: message/rfc822 or other email MIME types */
  emailData: string
  /** All available data types from the drag event */
  availableTypes: string[]
}

/** Synchronously snapshot everything from a DataTransfer before it clears. */
export function snapshotDrop(dt: DataTransfer): DropSnapshot {
  const availableTypes = Array.from(dt.types)
  
  // Helper to safely get data without throwing
  const safeGetData = (type: string): string => {
    try { return dt.getData(type) } catch { return '' }
  }

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
    plainText: safeGetData('text/plain'),
    htmlText: safeGetData('text/html'),
    emailData: safeGetData('message/rfc822') || safeGetData('application/x-moz-nativeimage'),
    availableTypes,
  }
}

/** Generate a simple .eml file from available email content */
function generateEmlFromContent(subject: string, plainText: string, htmlText: string): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const date = new Date().toUTCString()
  
  let eml = `MIME-Version: 1.0\r\n`
  eml += `Date: ${date}\r\n`
  eml += `Subject: ${subject}\r\n`
  eml += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`
  eml += `\r\n`
  
  if (plainText) {
    eml += `--${boundary}\r\n`
    eml += `Content-Type: text/plain; charset="UTF-8"\r\n`
    eml += `Content-Transfer-Encoding: quoted-printable\r\n`
    eml += `\r\n`
    eml += `${plainText}\r\n`
  }
  
  if (htmlText) {
    eml += `--${boundary}\r\n`
    eml += `Content-Type: text/html; charset="UTF-8"\r\n`
    eml += `Content-Transfer-Encoding: quoted-printable\r\n`
    eml += `\r\n`
    eml += `${htmlText}\r\n`
  }
  
  eml += `--${boundary}--\r\n`
  return eml
}

/** Extract a subject line from email content */
function extractSubject(plainText: string, htmlText: string): string {
  // Try to find subject in plain text (common in Outlook drag)
  const subjectMatch = plainText.match(/^Subject:\s*(.+)$/im)
  if (subjectMatch) return subjectMatch[1].trim()
  
  // Try HTML title
  const titleMatch = htmlText.match(/<title>([^<]+)<\/title>/i)
  if (titleMatch) return titleMatch[1].trim()
  
  // Use first line of plain text
  const firstLine = plainText.split('\n')[0]?.trim()
  if (firstLine && firstLine.length < 100) return firstLine
  
  return 'Dropped Email'
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

  // 4. Raw email data (message/rfc822)
  if (snap.emailData.trim()) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    return [new File([snap.emailData], `email-${ts}.eml`, { type: 'message/rfc822' })]
  }

  // 5. Email from HTML + plain text — create a .eml file
  const hasHtml = snap.htmlText.trim()
  const hasPlain = snap.plainText.trim()
  if (hasHtml || hasPlain) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const subject = extractSubject(snap.plainText, snap.htmlText)
    
    // If we have HTML, generate a proper .eml file for better parsing
    if (hasHtml) {
      const emlContent = generateEmlFromContent(subject, snap.plainText, snap.htmlText)
      const safeSubject = subject.replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 50).trim() || 'email'
      return [new File([emlContent], `${safeSubject}-${ts}.eml`, { type: 'message/rfc822' })]
    }
    
    // Plain text only — save as .txt
    return [new File([snap.plainText], `email-${ts}.txt`, { type: 'text/plain' })]
  }

  return []
}
