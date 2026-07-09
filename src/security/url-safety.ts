/**
 * SSRF and outbound-URL safety checks. Used before Param (or a tool) fetches a
 * URL, to block private/loopback/link-local targets and non-HTTP schemes.
 */
export type UrlSafety = { safe: boolean; reason: string };

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  // IPv6 loopback / unique-local
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
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
