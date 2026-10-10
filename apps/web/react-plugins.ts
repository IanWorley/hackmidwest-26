import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { PluginOption } from "vite";

/** One plugin list for the app and its tests, so tests render compiler-optimized components. */
export function reactPlugins(): PluginOption[] {
  return [react(), babel({ presets: [reactCompilerPreset()] })];
}
