---
name: agent-roam
description: >
  Agent-only Org-roam memory skill. Uses separate Emacs init, daemon, KB dir, and
  org-roam DB. Search via emacs tag query when tags exist; use rg for text search; edit tool for file edits.
---

# Agent Roam Skill

## Agent memory policy

- Memory store is agent-only Org-roam KB
- Keep flat Org-roam layout, no folder taxonomy required
- Do not write user normal zettelkasten by default
- Touch normal zettelkasten only with explicit user request or later promotion flow
- Use memory for continuity, not to override current user message

## Using user zettelkasten

- Default: do not edit user zettelkasten
- Edit user zettelkasten only when user explicitly asks
- When editing user zettelkasten, do not use or define functions declared in `init/init.el`
- When editing user zettelkasten, read `init/init.el` directly and use the Elisp contained there manually when needed

## Search policy

Search memory when likely useful:
- Default bias: query memory before answering whenever continuity might matter; if uncertain, run tag query first (do not skip based on confidence)
- HARD RULE: if relevant tag exists for current topic/task, MUST query that tag via `agent-memory-find-by-tag` before answering, unless already queried earlier in current task
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

Search order (mandatory):
1. Tag search first (Emacs): `agent-memory-find-by-tag`
2. Use `rg` text search only when:
   - no relevant tag exists, or
   - tag search returned insufficient results
- Do not start with `rg` when tag route is available

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
- Tag aggressively enough for recall, but keep tags high-signal for precision
- Use ~3–6 tags per note when practical; avoid both under-tagging and noisy over-tagging
- Each tag must add distinct retrieval value (no redundant synonyms)
- Prefer this schema:
  - topic (what): e.g. `web-search`, `nix`, `git`, `debugging`
  - artifact/system (where): e.g. `readme`, `home-manager`, `agent-roam`
  - method/constraint (how): e.g. `fallback`, `rate-limit`, `captcha`, `json-api`
  - project scope (when project-specific): MUST include exact project tag (e.g. `:skills-flake:`)
- Avoid low-signal tags (e.g. generic `docs`, `scan`, `notes`) unless genuinely primary retrieval keys
- Reuse canonical tags when they clearly match; create new tags only when they add real retrieval value
- Tags are coarse hints; detail belongs in title/body
- If uncertain, use `candidate`

Prefer tags already present in Org-roam DB (`agent-memory-list-tags`).
- Tag source of truth: system note titled `Agent memory tag taxonomy and governance`
- HARD RULE: never write a note using a tag not documented in taxonomy system note
- If creating a new tag, you MUST first update taxonomy system note with one-line description, then use tag in other notes
- If taxonomy note cannot be updated in current run, do not create/use new tag; fall back to existing tags only
- Use `:system:` only when note must be auto-injected as persistent system context
- For `:system:` notes, keep soft max 8–12 notes and hard max 20 notes
- If `:system:` note count exceeds soft max, review and demote least-critical notes first
- Do not use `:system:` for transient session details or one-off task logs
- Do not use `:system:` for most preferences/decisions that should be discovered via regular memory queries (including tag queries like `agent-memory-find-by-tag`)
- Periodically merge/rename near-duplicate tags to keep retrieval clean

## Writing policy

Write memory only when durable and likely reused:
- If user explicitly asks to remember something, you must persist it in Org-roam (create or update note), not just acknowledge it
- After persisting a user memory request, confirm what was saved (note title and file path)
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
- For project-specific preferences, create/update a dedicated project note with project-name tag (e.g. `:my-project:`), instead of mixing into global preference notes.

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

3. Ensure/open target daily note file
- Emacs fn (preferred): `agent-memory-ensure-daily-file` (non-interactive, agent-safe)
- Use only `agent-memory-ensure-daily-file` for daily creation/open in automation
- Avoid interactive daily capture/find functions in agent runs (`org-roam-dailies-capture-*`, `org-roam-dailies-find-*`), which can block `emacsclient`
- Example:
  - `emacsclient -s "$AGENT_EMACS_SOCKET" --eval '(agent-memory-ensure-daily-file (list 5 16 2026) ":session:")'`
- DB sync is handled by helper; explicit sync still OK if needed

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

## Reflection

Reflection prompt lives in `reflection.md`.
Use this prompt manually only if agent harness does not support agent-roam reflection.
