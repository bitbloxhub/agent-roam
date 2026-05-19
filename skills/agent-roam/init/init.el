;;; init.el --- agent-roam emacs init -*- lexical-binding: t -*-

(defgroup agent-roam nil
  "Agent-only Org-roam memory config."
  :group 'applications)

(defcustom agent-roam-state-dir (getenv "AGENT_ROAM_STATE_DIR")
  "Directory for runtime state."
  :type 'directory)

(defcustom agent-roam-kb-dir (getenv "AGENT_ROAM_KB_DIR")
  "Knowledge base root for agent-only Org-roam notes."
  :type 'directory)

(defcustom agent-roam-db-path nil
  "Path to agent-only org-roam.db (derived from AGENT_ROAM_STATE_DIR)."
  :type 'file)

(unless (and agent-roam-state-dir (> (length agent-roam-state-dir) 0))
  (error "AGENT_ROAM_STATE_DIR must be set"))

(unless (and agent-roam-kb-dir (> (length agent-roam-kb-dir) 0))
  (error "AGENT_ROAM_KB_DIR must be set"))

(setq agent-roam-db-path
      (expand-file-name "org-roam.db" agent-roam-state-dir))
(make-directory agent-roam-state-dir t)
(make-directory (file-name-directory agent-roam-db-path) t)
(make-directory agent-roam-kb-dir t)

(setq custom-file (expand-file-name "custom.el" agent-roam-state-dir))
(when (file-exists-p custom-file)
  (load custom-file nil t))

(require 'package)
(setq package-archives
      '(("gnu" . "https://elpa.gnu.org/packages/")
        ("melpa" . "https://melpa.org/packages/")))
(package-initialize)
(unless package-archive-contents
  (package-refresh-contents))

(unless (package-installed-p 'use-package)
  (package-install 'use-package))

(eval-when-compile
  (require 'use-package))
(setq use-package-always-ensure t)

(use-package org :ensure org)

(use-package
 org-roam
 :init
 (setq org-roam-directory
       (file-name-as-directory (expand-file-name agent-roam-kb-dir)))
 (setq org-roam-db-location (expand-file-name agent-roam-db-path))
 (setq org-roam-dailies-directory "daily/")
 (setq org-roam-dailies-capture-templates
       '(("d" "default" entry "* %?"
          :target
          (file+head "%<%Y-%m-%d>.org" "#+title: %<%Y-%m-%d>\n"))))
 :config (org-roam-db-autosync-mode 1))

(require 'org-id)
(require 'org-roam-dailies)

(defun agent-memory--slugify (s)
  (let ((down (downcase s)))
    (replace-regexp-in-string
     "-+" "-"
     (replace-regexp-in-string "[^[:alnum:]]+" "-" down))))

(defun agent-memory--parse-tags (tags)
  (cond
   ((null tags)
    nil)
   ((listp tags)
    tags)
   ((string-match-p ":" tags)
    (split-string tags ":" t))
   (t
    (split-string tags "[, ]+" t))))


(defun agent-memory--tags-line (tags)
  (if (and tags (> (length tags) 0))
      (format "#+filetags: :%s:\n"
              (mapconcat #'identity (delete-dups tags) ":"))
    ""))

(defun agent-memory-sync ()
  "Sync agent Org-roam DB."
  (interactive)
  (org-roam-db-sync)
  org-roam-db-location)

(defun agent-memory-create-node (title tags &optional body)
  "Create agent memory node with TITLE TAGS BODY. Return file path."
  (interactive "sTitle: \nsTags (:tag1:tag2:): \nsBody: ")
  (let* ((ts (format-time-string "%Y%m%d%H%M%S"))
         (slug (agent-memory--slugify title))
         (file
          (expand-file-name (format "%s-%s.org" ts slug)
                            org-roam-directory))
         (tag-list (agent-memory--parse-tags tags)))
    (with-current-buffer (find-file-noselect file)
      (erase-buffer)
      (insert (format "#+title: %s\n" title))
      (insert (agent-memory--tags-line tag-list))
      (insert "\n")
      (when (and body (> (length body) 0))
        (insert body)
        (unless (string-suffix-p "\n" body)
          (insert "\n")))
      (goto-char (point-min))
      (org-id-get-create)
      (save-buffer))
    (agent-memory-sync)
    file))

(defun agent-memory--expand-org-time-format (s ts)
  "Expand org capture %<...> time tokens in S using TS."
  (replace-regexp-in-string "%<\\([^>]+\\)>"
                            (lambda (_)
                              (format-time-string (match-string 1 s)
                                                  ts))
                            s
                            t t))

(defun agent-memory-daily-file-for-date (date)
  "Return Org-roam daily file path for DATE (decoded time values).
DATE format: (month day year), e.g. '(5 16 2026).
Path resolved from `org-roam-dailies-capture-templates` target when possible."
  (let*
      ((month (nth 0 date))
       (day (nth 1 date))
       (year (nth 2 date))
       (ts (encode-time 0 0 0 day month year))
       (template (car org-roam-dailies-capture-templates))
       (target (plist-get (nthcdr 4 template) :target))
       (rel
        (if (and (listp target)
                 (eq (car target) 'file+head)
                 (stringp (nth 1 target)))
            (agent-memory--expand-org-time-format (nth 1 target) ts)
          (error
           "Unsupported org-roam dailies target; expected file+head"))))
    (expand-file-name rel
                      (expand-file-name org-roam-dailies-directory
                                        org-roam-directory))))

(defun agent-memory-ensure-daily-file (&optional date tags)
  "Non-interactive daily create/open for agent automation.
Avoid interactive org-roam dailies capture/find fns in emacsclient flows.
DATE format: (month day year). Nil means today.
TAGS format: ':tag1:tag2:' or list."
  (let* ((target-date
          (or date
              (list
               (string-to-number (format-time-string "%m"))
               (string-to-number (format-time-string "%d"))
               (string-to-number (format-time-string "%Y")))))
         (file (agent-memory-daily-file-for-date target-date))
         (tag-list (agent-memory--parse-tags tags))
         (ts
          (encode-time 0
                       0
                       0
                       (nth 1 target-date)
                       (nth 0 target-date)
                       (nth 2 target-date))))
    (org-roam-dailies--capture ts t "d")
    (with-current-buffer (find-file-noselect file)
      (goto-char (point-min))
      (unless (re-search-forward "^#\\+filetags:" nil t)
        (when (and tag-list (> (length tag-list) 0))
          (forward-line 1)
          (insert (agent-memory--tags-line tag-list))))
      (goto-char (point-min))
      (org-id-get-create)
      (save-buffer))
    (agent-memory-sync)
    file))

(defun agent-memory-add-id-to-heading (&optional file heading)
  "Ensure Org ID for HEADING in FILE or current heading. Return ID."
  (interactive "fFile (optional): \nsHeading (optional): ")
  (with-current-buffer (if file
                           (find-file-noselect file)
                         (current-buffer))
    (when (and heading (> (length heading) 0))
      (goto-char (point-min))
      (unless (re-search-forward (format "^\\*+ %s$"
                                         (regexp-quote heading))
                                 nil t)
        (error "Heading not found: %s" heading)))
    (unless (org-at-heading-p)
      (org-back-to-heading t))
    (let ((id (org-id-get-create)))
      (save-buffer)
      (agent-memory-sync)
      id)))

(defun agent-memory-normalize-file (file &optional title tags)
  "Ensure FILE has title/tags and top-level ID."
  (interactive
   "fFile: \nsTitle (optional): \nsTags (:tag1:tag2:, optional): ")
  (with-current-buffer (find-file-noselect file)
    (goto-char (point-min))
    (unless (re-search-forward "^#\\+title:" nil t)
      (insert
       (format "#+title: %s\n"
               (if (> (length title) 0)
                   title
                 (file-name-base file)))))
    (goto-char (point-min))
    (unless (re-search-forward "^#\\+filetags:" nil t)
      (when (> (length tags) 0)
        (insert
         (agent-memory--tags-line (agent-memory--parse-tags tags)))))
    (goto-char (point-min))
    (org-id-get-create)
    (save-buffer))
  (agent-memory-sync)
  file)

(defun agent-memory-list-tags ()
  "Return unique tags from org-roam DB tags table."
  (interactive)
  (let* ((rows
          (org-roam-db-query
           [:select
            :distinct [tag]
            :from tags
            :where (not (= tag ""))
            :order-by tag
            :asc]))
         (tags (mapcar #'car rows)))
    (if (called-interactively-p 'interactive)
        (message "%s" (mapconcat #'identity tags " "))
      tags)))

(defun agent-memory-find-by-tag (tag)
  "Return Org file paths for TAG using org-roam DB tables only."
  (interactive "sTag: ")
  (let* ((rows
          (org-roam-db-query
           [:select
            :distinct [nodes:file]
            :from tags
            :inner-join nodes
            :on (= tags:node-id nodes:id)
            :where (= tags:tag $s1)
            :order-by nodes:file
            :asc]
           tag))
         (hits (mapcar #'car rows)))
    (if (called-interactively-p 'interactive)
        (message "%s" (mapconcat #'identity hits "\n"))
      hits)))


(message "agent-roam init loaded | kb=%s | state=%s | db=%s"
         agent-roam-kb-dir
         agent-roam-state-dir
         agent-roam-db-path)

(provide 'init)
;;; init.el ends here
