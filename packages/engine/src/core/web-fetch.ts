const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '169.254.169.254', // cloud metadata endpoint
]);

function isInternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');

    if (BLOCKED_HOSTS.has(hostname)) return true;

    // Private IPv4 ranges
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const a = Number(ipv4Match[1]);
      const b = Number(ipv4Match[2]);
      if (a === 10) return true;                              // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
      if (a === 192 && b === 168) return true;                // 192.168.0.0/16
      if (a === 169 && b === 254) return true;                // 169.254.0.0/16 (link-local)
    }

    return false;
  } catch {
    return false;
  }
}

export function detectUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];

  const cleaned = matches.map((url) => {
    return url.replace(/[.,;:!?)]+$/, '');
  });

  return [...new Set(cleaned)].filter((url) => !isInternalUrl(url));
}
