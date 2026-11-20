# Personal fork releases

`.github/workflows/personal-release.yml` runs hourly at minute 17 and supports
manual dispatch. Controller changes on `main` also trigger a run. Only `RicardoNid/t3code` can publish. The controller lives on the
fork's default branch; application changes remain on `feat/device-text-icons`.
Each run pins the latest stable upstream tag and the personal branch, then merges
them in the temporary CI checkout. A conflict stops the run for review.

Affected checks and personal regressions must pass before packaging. Only macOS
Apple Silicon DMG and Ubuntu 26.04 x64 DEB are uploaded, with `SHA256SUMS` and
`personal-release.json`. macOS uses ad hoc signing without Apple notarization.
No package is installed, no service is restarted, and no PR is created.

A candidate tag identifies the upstream tag, personal base and controller recipe.
Retries reuse that candidate and version; a completed promotion is recognized so
it cannot trigger an endless hourly build loop. After both installers pass, the
publisher uploads to a draft release, checks the asset allowlist, fast-forwards
the personal branch and publishes. If the personal branch moved during building,
the release remains a draft for review. Published assets are not overwritten.

Failed candidates and drafts are retained for diagnosis; the next scheduled run
retries an unpublished candidate. CI artifacts expire after three days. Release
assets remain available for rollback; no Windows, Intel Mac, Linux arm64, ZIP or
AppImage asset is published. GitHub's automatically provided source archives are
not binary builds.

Inspect the Actions run before retrying a persistent failure. A tag that changes
its upstream commit requires review, rather than a silent rebuild. The scheduler
runs on GitHub and needs no always-online desktop or stored local PAT.
`PERSONAL_RELEASE_SSH_KEY` holds a write deploy key restricted to this fork,
used only by the trusted resolver and publisher to push workflow-bearing merges.
Build/test jobs do not receive it. GitHub Releases use the job-scoped token. GitHub may
delay scheduled runs; manual dispatch is available when an immediate run is needed.
