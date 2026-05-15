{
  perSystem =
    {
      pkgs,
      ...
    }:
    {
      make-shells.default.packages = [
        (pkgs.emacs.pkgs.withPackages (epkgs: [
          epkgs.use-package
          epkgs.org
          epkgs.org-roam
          epkgs.elisp-autofmt
        ]))
      ];
    };
}
