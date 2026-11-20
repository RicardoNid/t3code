# Personal fork releases

`.github/workflows/personal-release.yml` runs hourly at minute 17 and supports
manual dispatch. Controller changes on `main` also trigger a run. Only `RicardoNid/t3code` can publish. The controller lives on the
fork's default branch; application changes remain on `feat/device-text-icons`.
Each run pins the latest stable upstream tag and the personal branch, then merges
them in the temporary CI checkout. A conflict stops the run for review.

Affected checks and personal regressions must pass before packaging. The only supported platforms are macOS Apple Silicon and Ubuntu 26.04 x64.
Releases include their DMG/DEB installers, macOS ZIP and Linux AppImage update payloads,
self-contained CLI archives for both platforms, and `latest-mac.yml` / `latest-linux.yml`,
with `SHA256SUMS` and `personal-release.json`. Feed hashes are computed after signing.
Release tags use `v<personal-version>` so native updaters can resolve them; recipe tags
still identify reproducible candidates. macOS uses ad hoc signing without Apple notarization;
these builds deliberately do not advertise native Squirrel updates until a properly signed
build is available. They can still be installed by the managed maintenance procedure.
The Linux build uses Ubuntu 24.04 to preserve the existing glibc ceiling, then
launches the shipped DEB on Ubuntu 26.04. The shipped DMG also receives an isolated
launch check. No personal machine is updated or restarted, and no PR is created.

A candidate tag identifies the upstream tag, personal base and controller recipe.
Retries reuse that candidate and version; a completed promotion is recognized so
it cannot trigger an endless hourly build loop. After both installers pass, the
publisher uploads to a draft release, checks the asset allowlist, fast-forwards
the personal branch and publishes. If the personal branch moved during building,
the release remains a draft for review. Published assets are not overwritten.

Failed candidates and drafts are retained for diagnosis; the next scheduled run
retries an unpublished candidate. CI artifacts expire after three days. Release
assets remain available for rollback; no Windows, Intel Mac or Linux arm64 asset is published. GitHub's automatically provided source archives are
not binary builds.

Inspect the Actions run before retrying a persistent failure. A tag that changes
its upstream commit requires review, rather than a silent rebuild. The scheduler
runs on GitHub and needs no always-online desktop or stored local PAT.
`PERSONAL_RELEASE_SSH_KEY` holds a write deploy key restricted to this fork,
used only by the trusted resolver and publisher to push workflow-bearing merges.
Build/test jobs do not receive it. GitHub Releases use the job-scoped token. GitHub may
delay scheduled runs; manual dispatch is available when an immediate run is needed.
