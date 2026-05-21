/**
 * Azure Block Blob upload tuning shared by the cache and artifact layers.
 *
 * @remarks
 * Both `ActionCacheLive` and `ArtifactLive` upload to Azure Block Blob storage
 * with the same `BlockBlobClient.uploadFile` block-size / concurrency settings
 * (matching `actions/cache` and `actions/artifact`). Centralized here so a
 * future tuning flows through to both rather than drifting.
 *
 * @internal
 */

/** Block size for `BlockBlobClient.uploadFile` (64 MiB). */
export const UPLOAD_CHUNK_SIZE = 64 * 1024 * 1024;

/** Parallel block uploads for `BlockBlobClient.uploadFile`. */
export const UPLOAD_CONCURRENCY = 8;

/** Single-shot upload ceiling; larger payloads are chunked (128 MiB). */
export const UPLOAD_MAX_SINGLE_SHOT = 128 * 1024 * 1024;
