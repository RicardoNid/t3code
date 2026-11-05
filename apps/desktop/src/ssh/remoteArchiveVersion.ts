// Personal releases only change the client; SSH bootstrap uses the matching published server.
export function remoteArchiveVersion(appVersion: string): string {
  return appVersion.replace(/^(\d+\.\d+\.\d+)-personal\.\d+(?:\.\d+)?$/, "$1");
}
