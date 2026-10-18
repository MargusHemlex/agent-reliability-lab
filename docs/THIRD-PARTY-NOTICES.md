# Third-party dependencies and notices

The repository's MIT license covers its authored code. It does not relicense dependencies or their notices. This project uses exact versions in `package-lock.json` and installs with `npm ci --ignore-scripts`; there are no vendored `node_modules` or built application outputs in Git.

The publication review inspected 72 locked dependency package records: 43 declared MIT, 28 Apache-2.0 and one declared `(AFL-2.1 OR BSD-3-Clause)`. Registry tarballs use HTTPS npm registry URLs with integrity values. License declarations and registry integrity are provenance evidence, not a legal or safety certification.

Primary runtime dependencies are eve 0.80.1 (Apache-2.0), AI SDK 7.0.143 (Apache-2.0) and Zod 4.6.7 (MIT). Installed eve includes LICENSE and NOTICE; AI SDK and Zod include their licenses. Preserve the applicable package licenses/notices if distributing dependencies or a compiled bundle. This source repository does not redistribute those bundles. A future distribution must review its own complete contents and applicable license choices.

On 2026-10-18, `npm audit --ignore-scripts --json` reported zero known advisories for the locked graph. This is a dated registry-advisory result, not proof that dependencies are vulnerability-free. Recheck before publication or upgrades.
