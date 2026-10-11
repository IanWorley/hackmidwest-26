import { useNavigate } from "@tanstack/react-router";
import { type JSX, useCallback } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  encodeLayers,
  MAP_LAYER_LABELS,
  type MapLayer,
  useMapLayers,
} from "./layers";

/** The URL owns which layers are on, so a reload or a shared link restores them. */
export function LayerToggles({
  available,
}: {
  available: readonly MapLayer[];
}): JSX.Element {
  const active = useMapLayers();
  const navigate = useNavigate({ from: "/conditions" });
  const showLayers = useCallback(
    (layers: string[]): Promise<void> =>
      navigate({ search: { layers: encodeLayers(layers) }, replace: true }),
    [navigate],
  );
  return (
    <ToggleGroup
      aria-label="Map layers"
      onValueChange={showLayers}
      type="multiple"
      value={active}
      variant="outline"
    >
      {available.map((layer) => (
        <ToggleGroupItem key={layer} value={layer}>
          {MAP_LAYER_LABELS[layer]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
