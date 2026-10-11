import type { JSX } from "react";
import { STANDING_POSTURES } from "@/features/closure/posture";
import { PostureBadge } from "@/features/closure/posture-fields";

export function PostureLegend(): JSX.Element {
  return (
    <ul aria-label="Posture legend" className="flex flex-wrap gap-2">
      {STANDING_POSTURES.map((posture) => (
        <li key={posture}>
          <PostureBadge posture={posture} />
        </li>
      ))}
    </ul>
  );
}
