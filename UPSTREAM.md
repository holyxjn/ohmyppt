# Upstream Sync

This repository is an unofficial modified distribution based on
[arcsin1/oh-my-ppt](https://github.com/arcsin1/oh-my-ppt), distributed under the
MIT License.

Recommended remotes:

```bash
git remote -v
# origin   git@github.com:holyxjn/ohmyppt.git
# upstream https://github.com/arcsin1/oh-my-ppt (fetch)
# upstream DISABLED (push)
```

To sync upstream changes:

```bash
git fetch upstream
git checkout main
git merge upstream/main
npm run typecheck
npm run build
git push
```

Keep the original `LICENSE` file and copyright notice in all substantial
copies of the project.
