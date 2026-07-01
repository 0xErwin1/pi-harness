{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.pi.coding-agent;
  harnessLib = import ../lib { inherit lib; };

  resourceFile = resource: {
    name = resource.target;
    value = {
      source = resource.source;
    }
    // lib.optionalAttrs resource.recursive { recursive = true; };
  };

  resourceFiles = lib.listToAttrs (map resourceFile cfg.resources);
in
{
  options.programs.pi.coding-agent = {
    enable = lib.mkEnableOption "Pi coding-agent harness integration";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = "Package installed when the Pi coding-agent harness integration is enabled.";
    };

    settings = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      description = "Settings staged for future mutable Pi configuration merging.";
    };

    resources = lib.mkOption {
      type = lib.types.listOf (
        lib.types.submodule {
          options = {
            source = lib.mkOption {
              type = lib.types.path;
              description = "Source path for a static harness resource.";
            };

            target = lib.mkOption {
              type = lib.types.str;
              description = "Home-relative target path for the static harness resource.";
            };

            recursive = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether Home Manager should link the resource recursively.";
            };
          };
        }
      );
      default = [ ];
      description = "Static harness resources projected into user tool paths.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Environment values reserved for future wrapper generation; use file paths, not secret values.";
    };

    extraArgs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Additional arguments reserved for future wrapper generation.";
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        home.packages = lib.optional (cfg.package != null) cfg.package;
        home.file = resourceFiles;
      }
      (lib.mkIf (cfg.settings != { }) {
        home.file.".pi/agent/settings.nix-generated.json".text = builtins.toJSON cfg.settings;
      })
      (lib.mkIf (cfg.environment != { }) {
        home.file.".pi/agent/pi-harness-env.sh".text =
          harnessLib.mkEnvironmentExports cfg.environment + "\n";
      })
    ]
  );
}
