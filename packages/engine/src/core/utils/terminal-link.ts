/** Wrap display text in an OSC 8 hyperlink pointing to a local file. */
export function fileLink(displayText: string, filePath: string): string {
  const uri = `file://${filePath.replace(/\\/g, '/')}`;
  return `\x1b]8;;${uri}\x07${displayText}\x1b]8;;\x07`;
}
