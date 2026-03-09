/**
 * OSC 8 terminal hyperlink helper.
 * Modern terminals (Windows Terminal, iTerm2, Hyper, etc.) render these as clickable links.
 */

// ANSI: bright blue(94) + solid underline(4) on, then underline off(24) + color reset(39)
const LINK_ON = '\x1b[94;4m';
const LINK_OFF = '\x1b[24;39m';

/** Style display text as a blue underlined path (no OSC 8 to avoid terminal dotted underlines). */
export function fileLink(displayText: string, _filePath: string): string {
  return `${LINK_ON}${displayText}${LINK_OFF}`;
}

/** Wrap display text in an OSC 8 hyperlink pointing to a URL. */
export function webLink(displayText: string, url: string): string {
  return `\x1b]8;;${url}\x07${LINK_ON}${displayText}${LINK_OFF}\x1b]8;;\x07`;
}
