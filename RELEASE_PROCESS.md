# Release Process

Releases are triggered by creating a GitHub Release. The `release.yaml` workflow then builds the package and publishes it to npm using trusted publishing (OIDC), which also attaches a provenance attestation automatically.

## Steps

1. Make sure all changes for this release are merged into `main`.
2. Bump `"version"` in `package.json` to `X.Y.Z`.
3. In `CHANGELOG.md`, add a new `## [X.Y.Z] - YYYY-MM-DD` section at the top summarising the changes in this release (`Added`, `Fixed`, `Changed`, `Security`).
4. Run `npm run webpack` locally and confirm the build is clean.
5. Create a release branch, commit, and open a PR into `main`:

   ```bash
   git checkout -b chore/release-vX.Y.Z
   git commit -am "chore: release vX.Y.Z"
   git push origin chore/release-vX.Y.Z
   # Open a PR and merge it once approved
   ```

6. On GitHub, go to **Releases → Draft a new release**:
   - Tag: `vX.Y.Z` (create it on `main` after the PR is merged)
   - Title: `vX.Y.Z`
   - Body: use the structure below — the auto-generated "What's Changed" PR list comes first, then append a hand-written `📝 Summary` section from the CHANGELOG entries:

     ```markdown
     ## What's Changed
     <!-- GitHub fills this in automatically from merged PRs -->

     ---

     ### 📝 Summary

     - **Added**:
       - Brief user-facing bullet for each new feature
     - **Fixed**:
       - Brief user-facing bullet for each bug fix
     - **Changed**:
       - Dependency bumps, internal refactors, config changes

     **Full Changelog**: https://github.com/Mapepire-IBMi/mapepire-js/compare/vPREV...vX.Y.Z
     ```

   - Click **Publish release**
7. The `release.yaml` workflow starts automatically, builds, and publishes to npm.

## If the release fails

1. Fix the cause and push the fix to `main`.
2. Delete the failed GitHub Release and its tag from the GitHub UI.
3. Repeat from step 6.

If the package was already published to npm, you cannot reuse that version number; bump to the next patch version instead.

## Verifying the release

- Check https://www.npmjs.com/package/@ibm/mapepire-js for the new version and its provenance badge.
- Check the **Actions** tab to confirm the `Release and Publish to NPM` run succeeded.
