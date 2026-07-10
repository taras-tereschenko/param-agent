/**
 * SSRF and outbound-URL safety checks. Used before Param (or a tool) fetches a
 * URL, to block private/loopback/link-local targets and non-HTTP schemes.
 */
export type UrlSafety = { safe: boolean; reason: string };

export function isPrivateHost(hostname: string): boolean {
  let host = hostname.toLowerCase().trim();
  // Strip IPv6 brackets.
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  // IPv6 loopback / unique-local (fc00::/7).
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) -> re-check the embedded IPv4.
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped && mapped[1]) {
    return isPrivateHost(mapped[1]);
  }
  // Non-dotted numeric encodings (decimal / hex / octal) are SSRF-evasion
  // shapes for a single 32-bit address; block conservatively.
  if (/^0x[0-9a-f]+$/.test(host) || /^\d{5,}$/.test(host)) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // Octal-prefixed dotted forms (e.g. 0177.0.0.1).
  if (/^0\d+\./.test(host)) {
    return true;
  }
  return false;
}

export function isSafeOutboundUrl(rawUrl: string): UrlSafety {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "invalid url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: `blocked scheme: ${url.protocol}` };
  }
  if (isPrivateHost(url.hostname)) {
    return { safe: false, reason: `blocked private/loopback host: ${url.hostname}` };
  }
  return { safe: true, reason: "ok" };
}
