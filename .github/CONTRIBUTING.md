# Contributing to mapepire-js

Thanks for considering contributing! Here is how you can help improve this project.

## Bug reports and feature requests

### Did you find a bug?

First, do [a quick search](https://github.com/Mapepire-IBMi/mapepire-js/issues) to see whether your issue has already been reported. If it has, please comment on the existing issue.

Otherwise, open [a new issue](https://github.com/Mapepire-IBMi/mapepire-js/issues/new/choose) with a clear title and description. Include:

- A short TypeScript snippet that reproduces the problem
- What you expected to happen and what actually happened (with the full error)
- The transport mode you are using (WebSocket, SSH Single, or Local Single)
- Your `mapepire-js` version, Node.js version, and IBM i version

### Do you have an idea for a new feature?

Open a feature request issue and explain the problem you are trying to solve. A rough TypeScript sketch of the API you have in mind is very helpful.

Security issues should **not** be reported in public issues. Use a [private security advisory](https://github.com/Mapepire-IBMi/mapepire-js/security/advisories/new) instead.

## Making a pull request

1. Fork the repository and create a branch for your change, e.g. `fix/short-description` or `feat/short-description`.
2. Copy `.env.sample` to `.env` and fill in your connection details, then run:

   ```bash
   npm ci
   npm run webpack   # build
   npm run test      # tests
   ```

   Most tests connect to a real IBM i. If you can't run them, mention it in your PR and we will run them for you.

3. Add or update tests. For bug fixes, include a test that fails without your fix.
4. Add JSDoc to any new public export, and keep `src/types.ts` and `src/index.ts` up to date if the public API changes. (`strict: false` in `tsconfig.json` is intentional, so please leave it as is.)
5. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Maintainers summarise changes in `CHANGELOG.md` at release time, so you don't need to edit it.
6. Open the PR against `main`, link the issue it addresses, and fill in the PR template.

More about the supported connection types is in the [transport README](../src/transports/README.md).

We look forward to reviewing your PR!
