// Personal source builds can be newer than the published CLI. This release has
// verified SHA256SUMS and runtime archives for all supported SSH host platforms.
const PERSONAL_REMOTE_ARCHIVE_VERSION = "0.1.10";

export function remoteArchiveVersion(appVersion: string): string {
  return /^\d+\.\d+\.\d+-personal\.\d+(?:\.\d+)?$/.test(appVersion)
    ? PERSONAL_REMOTE_ARCHIVE_VERSION
    : appVersion;
}
