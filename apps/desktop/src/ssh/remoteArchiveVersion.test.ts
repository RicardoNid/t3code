import { expect, it } from "vite-plus/test";
import { remoteArchiveVersion } from "./remoteArchiveVersion.ts";

it.each([
  ["0.1.7-personal.20261105", "0.1.10"],
  ["0.1.7-personal.20261105.2", "0.1.10"],
  ["0.1.7", "0.1.7"],
  ["0.1.11-personal.20261120.2", "0.1.10"],
  ["0.1.7-nightly.20261105.1", "0.1.7-nightly.20261105.1"],
  ["0.1.7-preview.20261105.1", "0.1.7-preview.20261105.1"],
])("resolves %s to the published remote runtime %s", (version, expected) => {
  expect(remoteArchiveVersion(version)).toBe(expected);
});
