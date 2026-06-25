export function internalApiOrigin() {
  const configured = process.env.PARAM_INTERNAL_API_ORIGIN?.trim().replace(/\/$/, "");
  if (configured) return configured;

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;

  return undefined;
}

export function internalApiHeaders() {
  const secret = process.env.PARAM_INTERNAL_API_SECRET?.trim();
  if (!secret) return undefined;

  return {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
}

export function isInternalApiConfigured() {
  return Boolean(internalApiOrigin() && internalApiHeaders());
}
