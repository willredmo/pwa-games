import { useState } from "react";
import { update, usePwaUpdate } from "../pwa";

/** Toast offering a newer build once it has downloaded (see pwa.ts). */
export function UpdatePrompt() {
  const ready = usePwaUpdate();
  const [dismissed, setDismissed] = useState(false);
  if (!ready || dismissed) return null;
  return (
    <div className="update-toast" role="status">
      <span>✨ A new version of Duel Deck is ready</span>
      {/* Reloads into the new build. The match resumes from the start of the
          current round, as after any reload. */}
      <button className="primary-btn" onClick={update}>
        Update
      </button>
      <button className="ghost-btn ghost-btn--sm" onClick={() => setDismissed(true)}>
        Later
      </button>
    </div>
  );
}
