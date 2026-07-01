{ lib, ... }:

{
  options.programs.pi-harness.enable = lib.mkEnableOption "Pi harness system-level scaffold";
  config = { };
}
