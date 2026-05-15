# AGENTS.md

## Project state

- Skill: `skills/agent-roam/`
- Emacs init dir: `skills/agent-roam/init/`
- Pi extension package: `pi/`
- Extension entrypoint: `pi/src/index.ts`
- Workspace uses pnpm catalogs in `pnpm-workspace.yaml`

## JS/TS checks

Run from repo root:

```bash
pnpm lint
pnpm lint:fix
pnpm typecheck
```

## Elisp formatting

Format all Elisp files with `elisp-autofmt-buffer`.

```bash
XDG_CONFIG_HOME="$(mktemp -d)" XDG_CACHE_HOME="$(mktemp -d)" XDG_STATE_HOME="$(mktemp -d)" \
nix develop -c emacs --batch \
  --eval '(setq user-emacs-directory (make-temp-file "emacs-user-dir-" t))' \
  --eval '(require (quote elisp-autofmt))' \
  --eval '(let ((files (if (executable-find "fd")
                           (process-lines "fd" "-e" "el" ".")
                         (directory-files-recursively "." "\\.el$"))))
            (dolist (file files)
              (with-current-buffer (find-file-noselect file)
                (elisp-autofmt-buffer)
                (save-buffer))))'
```

## Paren check

```bash
XDG_CONFIG_HOME="$(mktemp -d)" XDG_CACHE_HOME="$(mktemp -d)" XDG_STATE_HOME="$(mktemp -d)" \
nix develop -c emacs --batch \
  --eval '(setq user-emacs-directory (make-temp-file "emacs-user-dir-" t))' \
  --eval '(let ((files (if (executable-find "fd")
                           (process-lines "fd" "-e" "el" ".")
                         (directory-files-recursively "." "\\.el$"))))
            (dolist (file files)
              (with-temp-buffer
                (insert-file-contents file)
                (check-parens))))'
```
