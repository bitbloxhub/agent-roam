# Manual Bootstrap

This skill uses an agent-only Org-roam setup.

Required env vars:
- `AGENT_ROAM_KB_DIR`
- `AGENT_ROAM_STATE_DIR`
- `AGENT_EMACS_SOCKET`

Example values:
- `AGENT_ROAM_KB_DIR=~/org/agent-roam`
- `AGENT_ROAM_STATE_DIR=~/.local/state/agent-roam`
- `AGENT_EMACS_SOCKET=agent-memory`

## Start daemon

```bash
mkdir -p "$AGENT_ROAM_KB_DIR" "$AGENT_ROAM_STATE_DIR"

AGENT_ROAM_KB_DIR="$AGENT_ROAM_KB_DIR" \
AGENT_ROAM_STATE_DIR="$AGENT_ROAM_STATE_DIR" \
emacs --init-directory /absolute/path/to/agent-roam/skills/agent-roam/init --daemon="$AGENT_EMACS_SOCKET"
```

## Verify wiring

```bash
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(list org-roam-directory org-roam-db-location package-user-dir custom-file)'
```

## Core utility calls

Always do these before memory-aware responses:
- List current tag set
- Read all `:system:` tagged notes (full contents)

```bash
# list tags (markdown bullets)
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(princ (mapconcat (lambda (t) (format "- `%s`" t)) (agent-memory-list-tags) "\n"))'

# list files tagged system (DB-backed via emacs fn)
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-find-by-tag "system")'

# render full contents for all system-tagged notes
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(let ((files (agent-memory-find-by-tag "system"))) (princ (mapconcat (lambda (f) (with-temp-buffer (insert-file-contents f) (format "### %s\n%s" f (buffer-string)))) files "\n\n")))'

# create named note
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-create-node "Memory title" ":project:decision:" "body")'

# ensure/open today daily file (edit body separately with normal edit tool)
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-capture-daily ":session:")'

# add ID to heading
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-add-id-to-heading "/path/note.org" "Heading")'

# sync
emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(org-roam-db-sync)'
```

## Stop daemon

```bash
emacsclient -s "$AGENT_EMACS_SOCKET" -e '(kill-emacs)'
```
