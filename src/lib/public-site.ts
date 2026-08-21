/** Normalize the one deployment base used by Astro and every internal route. */
export function normalizePublicBase(value: string | undefined): string {
  if (!value || value === '/') return '/';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return `${withLeadingSlash.replace(/\/+$/, '')}/`;
}

/** Prefix an absolute Reader path with the configured public deployment base. */
export function publicPath(path: string, base = '/'): string {
  if (!path.startsWith('/')) throw new Error(`Public Reader path must start with /: ${path}`);
  const normalizedBase = normalizePublicBase(base);
  if (path === '/') return normalizedBase;
  return `${normalizedBase}${path.slice(1)}`;
}
