import {MAX_IMAGE_BYTES} from '../reports/constants';

/** Target must stay strictly below the assessment/backend hard limit. */
export const COMPRESSION_MAX_BYTES = MAX_IMAGE_BYTES - 1;

/**
 * JPEG quality ladder (0–100). Prefer higher quality first, then step down.
 * Useful visual quality typically remains acceptable through the mid-50s.
 */
export const COMPRESSION_QUALITY_STEPS = [
  85, 75, 65, 55, 45, 35, 28,
] as const;

/**
 * Longest-edge bounds (px). Aspect ratio is preserved via contain resize.
 * Start large, then shrink if quality alone cannot meet the byte budget.
 */
export const COMPRESSION_MAX_EDGE_STEPS = [
  2048, 1600, 1280, 1024, 800, 640,
] as const;

export const COMPRESSION_OUTPUT_MIME = 'image/jpeg' as const;
export const COMPRESSION_OUTPUT_EXT = '.jpg' as const;
