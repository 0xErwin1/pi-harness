{ lib }:

let
  inherit (lib)
    attrNames
    concatMap
    concatStringsSep
    escapeShellArg
    filterAttrs
    hasPrefix
    hasSuffix
    mapAttrsToList
    recursiveUpdate
    removePrefix
    ;

  vendorDir = ../vendor;

  assets = {
    agents = ../assets/agents;
    chains = ../assets/chains;
    support = ../assets/support;
    themes = ../assets/themes;
    orchestrator = ../assets/orchestrator.md;
    orchestratorLazy = ../assets/orchestrator;
    extensions = ../extensions;
    packages = ../packages;
    vendorExtensions = [
      {
        name = "pi-tool-renderer.ts";
        root = ../vendor/pi-tool-renderer;
        entry = "extensions/tool-renderer.ts";
      }
      {
        name = "pi-ask-user.ts";
        root = ../.;
        entry = "vendor/pi-ask-user/index.ts";
      }
    ];
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

  # A vendor entry's `root + entry` always resolves to a path under `vendorDir`,
  # regardless of whether `root` points at the vendor subdir directly or at the
  # repo root with a "vendor/..." prefixed entry. Reducing both forms through
  # `vendorDir` keeps this generic instead of special-casing each entry.
  vendorStoreRelPath =
    vendorExtension:
    let
      fullPath = toString (vendorExtension.root + "/${vendorExtension.entry}");
      vendorPrefix = toString vendorDir + "/";
    in
    if hasPrefix vendorPrefix fullPath then removePrefix vendorPrefix fullPath else fullPath;

  regularFilesWithSuffix =
    suffix: dir:
    attrNames (
      filterAttrs (name: type: type == "regular" && hasSuffix suffix name) (builtins.readDir dir)
    );

  runtimeThemes = map (name: {
    inherit name;
    path = assets.themes + "/${name}";
  }) (regularFilesWithSuffix ".json" assets.themes);

  runtimeExtensions =
    map (name: {
      inherit name;
      path = assets.extensions + "/${name}";
      storeRelPath = "extensions/${name}";
    }) (regularFilesWithSuffix ".ts" assets.extensions)
    ++ map (vendorExtension: {
      inherit (vendorExtension) name;
      path = vendorExtension.root + "/${vendorExtension.entry}";
      storeRelPath = "vendor/" + vendorStoreRelPath vendorExtension;
    }) assets.vendorExtensions;

  runtimeSkills = [ ];

  mkResourceArgs =
    {
      skills ? [ ],
      extensions ? [ ],
      themes ? [ ],
      promptTemplates ? [ ],
    }:
    pathFlags "--skill" skills
    ++ pathFlags "--extension" extensions
    ++ pathFlags "--theme" themes
    ++ pathFlags "--prompt-template" promptTemplates;
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
      resourceArgs = mkResourceArgs {
        inherit
          skills
          extensions
          themes
          promptTemplates
          ;
      };
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

  piSubagentsPackageSource = "npm:pi-subagents-j0k3r@1.4.4";

  inherit
    runtimeExtensions
    runtimeSkills
    runtimeThemes
    mkResourceArgs
    ;

  mkPiApp =
    {
      pkgs,
      pi,
      assetsPkg,
    }:
    let
      piAssetsRoot = "${assetsPkg}/share/pi-harness";

      extensionFlags = map (entry: "${piAssetsRoot}/${entry.storeRelPath}") runtimeExtensions;
      themeFlags = map (theme: "${piAssetsRoot}/assets/themes/${theme.name}") runtimeThemes;

      # Extensions are passed exclusively via --extension flags anchored inside
      # the assetsPkg store tree; they are never symlinked into the agent dir.
      # Pi treats a duplicate extension/tool registration as a fatal startup
      # error, so seeding a file here in addition to the flag would crash it.
      resourceArgs = mkResourceArgs {
        extensions = extensionFlags;
        themes = themeFlags;
      };

      piCommandLine = concatStringsSep " " ([ "pi" ] ++ map escapeShellArg resourceArgs ++ [ ''"$@"'' ]);
    in
    pkgs.writeShellApplication {
      name = "pi-harness-pi";
      runtimeInputs = [
        pi
        pkgs.coreutils
      ];
      text = ''
        ROOT="$(mktemp -d -t pi-harness.XXXXXX)"
        AGENT_DIR="$ROOT/agent"
        trap 'rm -rf "$ROOT"' EXIT

        mkdir -p "$AGENT_DIR"
        ln -s ${escapeShellArg "${piAssetsRoot}/assets/orchestrator.md"} "$AGENT_DIR/AGENTS.md"
        ln -s ${escapeShellArg "${piAssetsRoot}/assets/agents"} "$AGENT_DIR/agents"
        ln -s ${escapeShellArg "${piAssetsRoot}/assets/chains"} "$AGENT_DIR/chains"
        ln -s ${escapeShellArg "${piAssetsRoot}/assets/support"} "$AGENT_DIR/support"

        cat > "$AGENT_DIR/settings.json" <<'JSON'
        {"theme":"ayu-dark"}
        JSON

        export PI_CODING_AGENT_DIR="$AGENT_DIR"

        case "''${1-}" in
          install|remove|uninstall|update|list|config)
            pi "$@"
            ;;
          *)
            ${piCommandLine}
            ;;
        esac
      '';
    };
}
