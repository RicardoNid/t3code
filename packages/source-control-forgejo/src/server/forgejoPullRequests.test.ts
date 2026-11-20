import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { repositoryNameFromRemoteUrl } from "./ForgejoSourceControlProvider.ts";
import { ForgejoPullRequestSchema, toForgejoChangeRequest } from "./forgejoPullRequests.ts";

const decodeForgejoPullRequest = Schema.decodeEffect(ForgejoPullRequestSchema);

it.effect("names a mounted server's heads by owner and repository, apart from forks", () =>
  Effect.gen(function* () {
    for (const owner of ["maria", "reviewer"]) {
      const changeRequest = toForgejoChangeRequest(
        yield* decodeForgejoPullRequest({
          number: 42,
          title: "Greeting",
          html_url: "https://forgejo.example/forgejo/maria/project/pulls/42",
          state: "open",
          merged: false,
          base: {
            ref: "main",
            sha: "base",
            repo: { full_name: "maria/project", owner: { login: "maria" } },
          },
          head: {
            ref: "greeting",
            sha: "head",
            repo: { full_name: `${owner}/project`, owner: { login: owner } },
          },
        }),
      );
      expect(changeRequest).toMatchObject({
        headRefName: "greeting",
        isCrossRepository: owner !== "maria",
        headRepositoryNameWithOwner: `${owner}/project`,
        headRepositoryOwnerLogin: owner,
      });
      expect(
        repositoryNameFromRemoteUrl(`https://forgejo.example/forgejo/${owner}/project.git`),
      ).toBe(`${owner}/project`);
    }
    expect(repositoryNameFromRemoteUrl("git@forgejo.example:maria/project.git")).toBe(
      "maria/project",
    );
  }),
);

const headRepository = { full_name: "acme/web", owner: { login: "acme" } };

it.effect.each([
  ["refs/pull/42/head", "feature/original", headRepository, "feature/original"],
  ["refs/pull/42/head", "feature/original", null, "refs/pull/42/head"],
  ["refs/pull/42/head", undefined, headRepository, "refs/pull/42/head"],
  ["feature/live", "other", headRepository, "feature/live"],
] as const)(
  "recovers a deleted source branch from %s with label %s",
  ([ref, label, repo, expected]) =>
    Effect.gen(function* () {
      const pr = toForgejoChangeRequest(
        yield* decodeForgejoPullRequest({
          number: 42,
          title: "Merged",
          html_url: "https://forgejo.test/acme/web/pulls/42",
          state: "closed",
          merged: true,
          base: { ref: "main", sha: "base", repo: null },
          head: { ref, ...(label === undefined ? {} : { label }), sha: "head", repo },
        }),
      );
      expect(pr.headRefName).toBe(expected);
    }),
);
