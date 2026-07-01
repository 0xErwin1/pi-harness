{ lib }:

let
  inherit (lib)
    concatStringsSep
    escapeShellArg
    mapAttrsToList
    recursiveUpdate
    ;

  assets = {
    agents = ../assets/agents;
    chains = ../assets/chains;
    support = ../assets/support;
    orchestrator = ../assets/orchestrator.md;
    extensions = ../extensions;
    packages = ../packages;
  };
in
{
  inherit assets;

  mergeJsonAttrs = base: override: recursiveUpdate base override;

  mkProjection =
    {
      source,
      target,
      recursive ? false,
    }:
    {
      inherit source target recursive;
    };

  mkEnvironmentExports =
    environment:
    concatStringsSep "\n" (
      mapAttrsToList (name: value: "export ${name}=${escapeShellArg (toString value)}") environment
    );

  mkWrapperScript =
    {
      command,
      environment ? { },
      extraArgs ? [ ],
    }:
    let
      exports = concatStringsSep "\n" (
        mapAttrsToList (name: value: "export ${name}=${escapeShellArg (toString value)}") environment
      );
      commandLine = concatStringsSep " " (
        [ (toString command) ] ++ map escapeShellArg extraArgs ++ [ ''"$@"'' ]
      );
    in
    ''
      set -euo pipefail
      ${exports}
      exec ${commandLine}
    '';
}
