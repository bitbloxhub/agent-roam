{
  inputs,
  ...
}:
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

      packages.pi-extension = pkgs.stdenv.mkDerivation {
        pname = "agent-roam-pi-extension";
        version = inputs.self.shortRev or inputs.self.dirtyShortRev or "dirty";
        src = ../.;

        nativeBuildInputs = [
          pkgs.nodejs
          pkgs.pnpmConfigHook
          pkgs.pnpm_10
        ];

        pnpm_config_manage_package_manager_versions = "false";
        pnpm_config_auto_install_peers = "false";
        pnpmWorkspaces = [ "agent-roam-pi" ];
        pnpmDeps = pkgs.fetchPnpmDeps {
          pname = "agent-roam-pi-extension-deps";
          version = inputs.self.shortRev or inputs.self.dirtyShortRev or "dirty";
          src = ../.;
          pnpmWorkspaces = [ "agent-roam-pi" ];
          pnpm = pkgs.pnpm_10;
          fetcherVersion = 3;
          hash = "sha256-MipjP9qQT/zMJd8Y6/GVJP+5QR4+9eznDr5h30MNqZM=";
        };

        installPhase = ''
          runHook preInstall
          tmp="$TMPDIR/agent-roam-pi-extension-out"
          rm -rf "$tmp"
          mkdir -p "$tmp"
          mkdir -p "$out"

          pnpm --config.auto-install-peers=false --config.strict-peer-dependencies=false --filter=agent-roam-pi deploy --legacy --prod --offline "$tmp"

          # Copy to $out with symlink dereference to avoid /build/source/* workspace links.
          cp -aL "$tmp"/. "$out"/

          runHook postInstall
        '';
      };
    };
}
