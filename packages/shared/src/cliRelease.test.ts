import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveTarCommand,
  cliReleaseAssetUrl,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("keeps personal binaries and discovery on the fork while preserving explicit mirrors", () => {
    const version = "0.1.11-personal.20261120.5";
    expect(cliReleaseAssetUrl(version, "SHA256SUMS")).toBe(
      `https://github.com/RicardoNid/t3code/releases/download/v${version}/SHA256SUMS`,
    );
    expect(cliReleaseIndexPageUrl(2, version)).toBe(
      "https://api.github.com/repos/RicardoNid/t3code/releases?per_page=100&page=2",
    );
    expect(cliReleaseAssetUrl(version, "SHA256SUMS", "https://mirror.example/t3?token=test")).toBe(
      `https://mirror.example/t3/v${version}/SHA256SUMS?token=test`,
    );
    expect(cliReleaseAssetUrl("0.1.11", "SHA256SUMS")).toBe(
      "https://github.com/pingdotgg/t3code/releases/download/v0.1.11/SHA256SUMS",
    );
    const releases = [{ tag_name: "v0.1.12" }, { tag_name: `v${version}` }];
    expect(newestCliReleaseVersion(releases, "stable", version)).toBe(version);
    expect(newestCliReleaseVersion(releases, "stable")).toBe("0.1.12");
    expect(newestCliReleaseVersion([{ tag_name: `v${version}` }], "stable")).toBeUndefined();
  });
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });
});
