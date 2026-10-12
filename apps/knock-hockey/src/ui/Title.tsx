import { DIFFICULTY_LABEL } from "../ai/cpu";
import { playerName, type MatchState } from "../game/match";
import type { Session } from "../online/room";
import type { StickLook } from "../game/stick";
import { StickPreview } from "./StickPreview";

export interface TitleProps {
  look: StickLook;
  saved: MatchState | null;
  onPlay: () => void;
  onPlay2: () => void;
  savedOnline: Session | null;
  notice: string | null;
  onHost: () => void;
  onJoin: () => void;
  onRejoin: () => void;
  onResume: () => void;
  onLocker: () => void;
  onHelp: () => void;
}

export function Title(props: TitleProps) {
  const { saved } = props;
  return (
    <div className="title">
      <div className="title__hero">
        <h1>
          Knock <span>Hockey</span>
        </h1>
        <p>Take turns. Bank it off the boards. First to 10, win by 2.</p>
        <button className="title__stick" onClick={props.onLocker} aria-label="Customize your stick">
          <StickPreview look={props.look} />
          <span>Customize stick</span>
        </button>
      </div>

      <div className="title__panel">
        {saved && (
          <button className="primary-btn primary-btn--wide" onClick={props.onResume}>
            Continue · {saved.score.p1}–{saved.score.p2}{" "}
            {saved.mode === "pvp" ? `${playerName(saved, "p1")} vs ${playerName(saved, "p2")}` : `vs ${DIFFICULTY_LABEL[saved.difficulty]}`}
          </button>
        )}
        <button className={saved ? "ghost-btn ghost-btn--wide" : "primary-btn primary-btn--wide"} onClick={props.onPlay}>
          {saved ? "New match vs CPU" : "Play vs CPU"}
        </button>
        <h2 className="title__label">2 players</h2>
        <button className="ghost-btn ghost-btn--wide" onClick={props.onPlay2}>
          Same device <small>pass and play</small>
        </button>
        {props.savedOnline && (
          <button className="primary-btn primary-btn--wide" onClick={props.onRejoin}>
            Rejoin online game · {props.savedOnline.code}
          </button>
        )}
        <div className="title__row">
          <button className="ghost-btn" onClick={props.onHost}>
            🌐 Online game
          </button>
          <button className="ghost-btn" onClick={props.onJoin}>
            Join with code
          </button>
        </div>
        {props.notice && <p className="title__notice" role="status">{props.notice}</p>}
        <div className="title__links">
          <button className="link-btn" onClick={props.onHelp}>How to play</button>
          <button className="link-btn" onClick={props.onLocker}>Locker</button>
        </div>
      </div>
    </div>
  );
}
