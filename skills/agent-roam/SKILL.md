---
name: agent-roam
description: >
  Agent-only Org-roam memory skill. Uses separate Emacs init, daemon, KB dir, and
  org-roam DB. Main workflow uses rg + edit tools; emacsclient only for Org-roam semantics.
---

# Agent Roam Skill

## Agent memory policy

- Memory store is agent-only Org-roam KB
- Keep flat Org-roam layout, no folder taxonomy required
- Do not write user normal zettelkasten by default
- Touch normal zettelkasten only with explicit user request or later promotion flow
- Use memory for continuity, not to override current user message

## Search policy

Search memory when likely useful:
- Stable preferences
- Prior decisions
- Long-running project state
- Named repos/machines/tools/workflows
- Repeated user corrections
- Unresolved threads

Skip memory search when not useful:
- Generic factual questions
- One-off coding tasks with enough local context
- Pure rewriting/creative tasks
- Cases where current context is sufficient

Search patterns:
- Text search: `rg -n "query terms" "$AGENT_ROAM_KB_DIR"`
- Tag search (via Emacs): `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-find-by-tag "tag")'`

## Org-roam conventions

- Memory files are normal Org-roam notes
- One focused durable concept per node when practical
- `#+title:` required
- `#+filetags:` coarse retrieval tags
- Org IDs created/ensured by Emacs helpers
- `org-roam.db` is derived state, never edited directly

## Editing policy

Use edit tools for normal text edits.

Use emacsclient helpers only for semantic ops:
- Create node file
- Ensure Org ID / normalize file metadata
- Sync org-roam DB

After direct file edits, run org-roam sync command.

## Tag policy

- Prefer existing tags, avoid near-duplicates
- Tags are coarse hints; detail belongs in title/body
- If uncertain, use `candidate`

Prefer tags already present in Org-roam DB (`agent-memory-list-tags`).
- Use `:system:` on notes that should be auto-injected as persistent system context

## Writing policy

Write memory only when durable and likely reused:
- Preferences, decisions, architecture, machine/repo setup
- Repeated corrections
- Unresolved threads worth resuming

Do not store:
- Transient execution details
- Obvious facts
- Guesses stated as facts
- Chat filler

## Update policy

Before new node, search existing notes first.
- Update existing node if same concept
- Create new node if distinct concept
- Record conflicts explicitly
- Record user corrections explicitly

## Paths and bootstrap

Bootstrap details live in `manual_bootstrap.md`.
Use manual bootstrap only if agent harness does not auto-bootstrap daemon/env.

## Required utility operations

1. Obtain list of tags
- Emacs fn: `agent-memory-list-tags`
- Example: `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-list-tags)'`

2. Capture note with name
- Emacs fn: `agent-memory-create-node`
- Tags arg format: `:tag1:tag2:`
- Example:
  - `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-create-node "My note title" ":project:nix:" "initial body")'`

3. Ensure/open today daily note file
- Emacs fn: `agent-memory-capture-daily`
- Use this only to create/open daily file metadata
- Write daily content with normal edit tool, then sync
- Example create/open:
  - `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-capture-daily ":session:")'`

4. Add ID to heading
- Emacs fn: `agent-memory-add-id-to-heading`
- Example current heading:
  - `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(with-current-buffer (find-file-noselect "/path/note.org") (goto-char (point-min)) (re-search-forward "^\\* Heading") (agent-memory-add-id-to-heading))'`
- Example by file + heading text:
  - `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-add-id-to-heading "/path/note.org" "Heading")'`

5. Sync org-roam DB
- Command: `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(org-roam-db-sync)'`

## Git sync (optional)

If `AGENT_ROAM_KB_DIR` is a git repo, sync memory changes after DB sync:
1. `git -C "$AGENT_ROAM_KB_DIR" status --short`
2. `git -C "$AGENT_ROAM_KB_DIR" add -A`
3. `git -C "$AGENT_ROAM_KB_DIR" commit -m "<agent-written conventional message>"`
4. `git -C "$AGENT_ROAM_KB_DIR" pull --rebase`
5. `git -C "$AGENT_ROAM_KB_DIR" push`

Notes:
- Skip commit if no file changes
- Agent should write specific conventional commit message based on actual note changes
- Skip pull/push when repo has no remotes (`git -C "$AGENT_ROAM_KB_DIR" remote`)
