;;; early-init.el --- agent-roam emacs init -*- lexical-binding: t -*-

;; Keep startup side effects out of skill directory.

(let* ((state-root (getenv "AGENT_ROAM_STATE_DIR")))
  (unless (and state-root (> (length state-root) 0))
    (error "AGENT_ROAM_STATE_DIR must be set"))
  (let ((cache-root (expand-file-name "cache/" state-root)))
    (make-directory cache-root t)

    (setq package-user-dir (expand-file-name "elpa/" state-root))
    (setq native-comp-eln-load-path
          (list (expand-file-name "eln-cache/" cache-root)))
    (setq url-configuration-directory
          (expand-file-name "url/" cache-root))
    (setq auto-save-list-file-prefix
          (expand-file-name "auto-save/sessions/" cache-root))
    (setq backup-directory-alist
          `(("." . ,(expand-file-name "backups/" cache-root))))
    (setq auto-save-file-name-transforms
          `((".*" ,(expand-file-name "auto-save/" cache-root) t)))
    (setq tramp-persistency-file-name
          (expand-file-name "tramp" cache-root))))

(provide 'early-init)
;;; early-init.el ends here
