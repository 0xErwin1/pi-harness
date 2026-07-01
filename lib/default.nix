{ lib }:

let
  inherit (lib)
    concatMap
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

  pathFlags =
    flag: paths:
    concatMap (path: [
      flag
      (toString path)
    ]) paths;

  resourceForJson = resource: {
    source = toString resource.source;
    target = resource.target;
    recursive = resource.recursive or false;
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

  mkCodingAgentWrapper =
    {
      command,
      environment ? { },
      resources ? [ ],
      skills ? [ ],
      extensions ? [ ],
      themes ? [ ],
      promptTemplates ? [ ],
      extraArgs ? [ ],
      settingsFile ? "$HOME/.pi/agent/settings.json",
      modelsFile ? "$HOME/.pi/agent/models.json",
    }:
    let
      resourceArgs =
        pathFlags "--skill" skills
        ++ pathFlags "--extension" extensions
        ++ pathFlags "--theme" themes
        ++ pathFlags "--prompt-template" promptTemplates;
      args = resourceArgs ++ extraArgs;
      commandLine = concatStringsSep " " (
        [ (escapeShellArg (toString command)) ] ++ map escapeShellArg args ++ [ ''"$@"'' ]
      );
      resourcesJson = builtins.toJSON (map resourceForJson resources);
      environmentExports = concatStringsSep "\n" (
        mapAttrsToList (name: value: "export ${name}=${escapeShellArg (toString value)}") environment
      );
    in
    ''
      set -euo pipefail
      ${environmentExports}
      export PI_HARNESS_SETTINGS_FILE="${settingsFile}"
      export PI_HARNESS_MODELS_FILE="${modelsFile}"
      export PI_HARNESS_RESOURCES_JSON=${escapeShellArg resourcesJson}

      case "''${1-}" in
        install|remove|uninstall|update|list|config)
          exec ${escapeShellArg (toString command)} "$@"
          ;;
        *)
          exec ${commandLine}
          ;;
      esac
    '';
}
