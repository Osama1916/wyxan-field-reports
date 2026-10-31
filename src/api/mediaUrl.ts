import {getApiBaseUrl} from './config';

/**
 * Resolves a backend image URL for React Native Image.
 * Absolute http(s) URLs pass through; relative paths (e.g. `/uploads/...`)
 * are joined with the configured API base URL — never hardcodes host/IP.
 */
export function resolveServerImageUrl(
  url: string | null | undefined,
  baseUrl: string = getApiBaseUrl(),
): string | null {
  if (url == null) {
    return null;
  }
  const trimmed = url.trim();
  if (trimmed === '') {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const base = baseUrl.replace(/\/$/, '');
  if (trimmed.startsWith('/')) {
    return `${base}${trimmed}`;
  }
  return `${base}/${trimmed}`;
}
