{
  perSystem =
    {
      pkgs,
      ...
    }:
    {
      make-shells.default = {
        packages = [
          pkgs.nodejs_25
          pkgs.pnpm_10
        ];

        shellHook = ''
          export PATH=$(pwd)/node_modules/.bin/:$PATH
        '';
      };
    };
}
