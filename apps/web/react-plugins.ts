import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";

/** One plugin list for the app and its tests, so tests render compiler-optimized components. */
export function reactPlugins() {
  return [react(), babel({ presets: [reactCompilerPreset()] })];
}
