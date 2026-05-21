{
  perSystem =
    {
      pkgs,
      ...
    }:
    {
      packages.skill = pkgs.runCommand "skill-agent-roam" { } ''
        cp -r ${../skills/agent-roam} $out
      '';
    };
}
