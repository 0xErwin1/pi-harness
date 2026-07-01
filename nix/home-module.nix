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

  activationEntry =
    script:
    if lib ? hm && lib.hm ? dag then lib.hm.dag.entryAfter [ "writeBoundary" ] script else script;

  hasMutableConfig = cfg.settings != { } || cfg.models != null;
  settingsJson = builtins.toJSON cfg.settings;
  modelsIsAttrs = cfg.models != null && builtins.isAttrs cfg.models;
  modelsJson = if modelsIsAttrs then builtins.toJSON cfg.models else null;

  settingsActivation = lib.optionalString (cfg.settings != { }) ''
        cat > "$generated_dir/settings.json" <<'PI_HARNESS_JSON'
    ${settingsJson}
    PI_HARNESS_JSON
        merge_json "$agent_dir/settings.json" "$generated_dir/settings.json"
  '';

  modelsActivation = lib.optionalString (cfg.models != null) (
    if modelsIsAttrs then
      ''
                cat > "$generated_dir/models.json" <<'PI_HARNESS_JSON'
        ${modelsJson}
        PI_HARNESS_JSON
                merge_json "$agent_dir/models.json" "$generated_dir/models.json"
      ''
    else
      ''
        cp ${lib.escapeShellArg (toString cfg.models)} "$generated_dir/models.json"
        chmod 0600 "$generated_dir/models.json"
        merge_json "$agent_dir/models.json" "$generated_dir/models.json"
      ''
  );

  mutableConfigActivation = activationEntry ''
        set -euo pipefail

        agent_dir="$HOME/.pi/agent"
        generated_dir="$HOME/.local/share/pi-harness/generated"
        mkdir -p "$agent_dir" "$generated_dir"

        merge_json() {
          target="$1"
          generated="$2"
          tmp="$(mktemp "$target.XXXXXX")"

          if [ -L "$target" ]; then
            rm "$target"
          fi

          ${pkgs.python3}/bin/python3 - "$target" "$generated" "$tmp" <<'PY'
    import json
    import os
    import sys


    def load_json(path):
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            return {}
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)


    def merge(base, override):
        if isinstance(base, dict) and isinstance(override, dict):
            merged = dict(base)
            for key, value in override.items():
                merged[key] = merge(merged[key], value) if key in merged else value
            return merged
        return override


    target, generated, tmp = sys.argv[1:]
    merged = merge(load_json(target), load_json(generated))
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, target)
    PY
        }

        ${settingsActivation}
        ${modelsActivation}
  '';

  wrapperFile = {
    name = cfg.wrapper.target;
    value = {
      executable = true;
      text = harnessLib.mkCodingAgentWrapper {
        inherit (cfg)
          environment
          resources
          skills
          extensions
          themes
          promptTemplates
          extraArgs
          ;
        command = cfg.wrapper.command;
      };
    };
  };
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
      description = "Settings merged into the mutable ~/.pi/agent/settings.json file at activation time.";
    };

    models = lib.mkOption {
      type = lib.types.nullOr (lib.types.either lib.types.path lib.types.attrs);
      default = null;
      description = "Model data merged into the mutable ~/.pi/agent/models.json file at activation time.";
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

    skills = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [ ];
      description = "Skill paths passed to the generated Pi runtime wrapper as repeated --skill flags.";
    };

    extensions = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [ ];
      description = "Extension paths passed to the generated Pi runtime wrapper as repeated --extension flags.";
    };

    themes = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [ ];
      description = "Theme paths passed to the generated Pi runtime wrapper as repeated --theme flags.";
    };

    promptTemplates = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [ ];
      description = "Prompt template paths passed to the generated Pi runtime wrapper as repeated --prompt-template flags.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Environment values for generated Pi harness scripts; use file paths, not secret values.";
    };

    extraArgs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Additional arguments appended by the generated Pi runtime wrapper.";
    };

    wrapper = lib.mkOption {
      type = lib.types.submodule {
        options = {
          enable = lib.mkOption {
            type = lib.types.bool;
            default = false;
            description = "Whether to generate an opt-in Pi runtime wrapper script.";
          };

          target = lib.mkOption {
            type = lib.types.str;
            default = ".local/bin/pi-harness-pi";
            description = "Home-relative path for the generated wrapper script.";
          };

          command = lib.mkOption {
            type = lib.types.str;
            default = "pi";
            description = "Command executed by the generated wrapper.";
          };
        };
      };
      default = { };
      description = "Opt-in generated wrapper that carries resource flags and mutable config paths into Pi runtime.";
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        home.packages = lib.optional (cfg.package != null) cfg.package;
        home.file = resourceFiles;
      }
      (lib.mkIf hasMutableConfig {
        home.activation.piCodingAgentMutableConfig = mutableConfigActivation;
      })
      (lib.mkIf (cfg.environment != { }) {
        home.file.".pi/agent/pi-harness-env.sh".text =
          harnessLib.mkEnvironmentExports cfg.environment + "\n";
      })
      (lib.mkIf cfg.wrapper.enable {
        home.file = lib.listToAttrs [ wrapperFile ];
      })
    ]
  );
}
