import {Platform} from 'react-native';

/**
 * Development API base URL.
 * - Android emulator → host loopback via 10.0.2.2
 * - iOS simulator → localhost
 * Override with global __FIELDREPORTS_API_BASE_URL__ in Metro if needed.
 */
declare const global: typeof globalThis & {
  __FIELDREPORTS_API_BASE_URL__?: string;
};

const DEFAULT_ANDROID_EMULATOR_BASE = 'http://10.0.2.2:3000';
const DEFAULT_IOS_SIMULATOR_BASE = 'http://localhost:3000';

export function getApiBaseUrl(): string {
  const override = global.__FIELDREPORTS_API_BASE_URL__;
  if (typeof override === 'string' && override.trim() !== '') {
    return override.replace(/\/$/, '');
  }
  if (Platform.OS === 'android') {
    return DEFAULT_ANDROID_EMULATOR_BASE;
  }
  return DEFAULT_IOS_SIMULATOR_BASE;
}

/** Multipart upload timeout (ms). Chaos hang tests should stay under this. */
export const UPLOAD_REQUEST_TIMEOUT_MS = 60_000;

/** Soft timeout used for health checks. */
export const HEALTH_REQUEST_TIMEOUT_MS = 8_000;
