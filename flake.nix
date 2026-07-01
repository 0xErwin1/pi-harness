{
  description = "Personal Pi coding-agent harness";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
      harnessLib = import ./lib { lib = nixpkgs.lib; };

      assets = harnessLib.assets;

      packagesFor =
        system:
        let
          pkgs = pkgsFor system;
          assetsPackage = pkgs.runCommandLocal "pi-harness-assets" { } ''
            mkdir -p $out/share/pi-harness
            cp -R ${./assets} $out/share/pi-harness/assets
            cp -R ${./extensions} $out/share/pi-harness/extensions
            cp -R ${./packages} $out/share/pi-harness/packages
            cp ${./package.json} $out/share/pi-harness/package.json
          '';
        in
        {
          pi-harness-assets = assetsPackage;
          default = assetsPackage;
        };
    in
    {
      lib = harnessLib;
      inherit assets;

      packages = forAllSystems packagesFor;

      overlays.default = final: _prev: {
        pi-harness-assets = self.packages.${final.stdenv.hostPlatform.system}.pi-harness-assets;
        pi-harness = self.packages.${final.stdenv.hostPlatform.system}.default;
      };

      homeModules.default = import ./nix/home-module.nix;
      homeModules.pi-harness = self.homeModules.default;
      homeManagerModules = self.homeModules;

      nixosModules.pi-harness = import ./nix/nixos-module.nix;
      nixosModules.default = self.nixosModules.pi-harness;

      apps = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          relink = pkgs.writeShellApplication {
            name = "pi-harness-relink";
            runtimeInputs = [ pkgs.bash ];
            text = ''
              exec bash ${./scripts/link.sh} "$@"
            '';
          };
        in
        {
          relink = {
            type = "app";
            program = nixpkgs.lib.getExe relink;
          };
          default = self.apps.${system}.relink;
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt-rfc-style);

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          assets-present = pkgs.runCommandLocal "pi-harness-assets-present" { } ''
            test -f ${assets.orchestrator}
            test -d ${assets.agents}
            test -d ${assets.chains}
            test -d ${assets.support}
            test -d ${assets.extensions}
            test -d ${assets.packages}
            touch $out
          '';
          assets-package = self.packages.${system}.pi-harness-assets;
        }
      );
    };
}
