import { useCallback, useEffect, useState } from "react";
import { other, setupOf, loadMatch, loadSettings, newMatch, saveMatch, saveSettings, type MatchState, type Mode, type Settings } from "./game/match";
import { loadLook, saveLook, type LookSlot, type StickLook } from "./game/stick";
import { setSoundEnabled } from "./game/sound";
import { Game } from "./ui/Game";
import { Title } from "./ui/Title";
import { Locker } from "./ui/Locker";
import { HelpPanel } from "./ui/HelpPanel";
import { UpdatePrompt } from "./ui/UpdatePrompt";
import { Lobby, type LobbyProps } from "./ui/Lobby";
import { MatchSetup, type MatchChoice, type SetupMode } from "./ui/MatchSetup";
import { fixMatch, loadSession, readSession, saveSession, type Session } from "./online/room";
import "./App.css";

type Screen = "title" | "game";
export type Looks = Record<LookSlot, StickLook>;

/** A code from a shared invite link (?join=CODE), taken once at startup. */
function takeJoinCode(): string | undefined {
  try {
    const url = new URL(location.href);
    const code = url.searchParams.get("join") ?? undefined;
    if (code) {
      url.searchParams.delete("join");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    return code;
  } catch {
    return undefined;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("title");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [looks, setLooks] = useState<Looks>(() => ({ p1: loadLook("p1"), p2: loadLook("p2") }));
  const [saved, setSaved] = useState<MatchState | null>(loadMatch);
  const [match, setMatch] = useState<MatchState | null>(null);
  /** Which player's stick the Locker is editing, or null when closed. */
  const [locker, setLocker] = useState<LookSlot | null>(null);
  const [help, setHelp] = useState(false);
  /** The online game this device is in, if any. */
  const [online, setOnline] = useState<Session | null>(null);
  /** A saved online game to offer rejoining (after a reload). */
  const [savedOnline, setSavedOnline] = useState<Session | null>(loadSession);
  const [lobby, setLobby] = useState<Pick<LobbyProps, "kind" | "session" | "code" | "setup"> | null>(() => {
    const code = takeJoinCode();
    return code ? { kind: "join", code } : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  /** The match settings sheet, open for this kind of game. */
  const [setupFor, setSetupFor] = useState<SetupMode | null>(null);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);
  useEffect(() => saveLook("p1", looks.p1), [looks.p1]);
  useEffect(() => saveLook("p2", looks.p2), [looks.p2]);

  /** The settings sheet a new game opens with, from the last choices. */
  const lastChoice: MatchChoice = { difficulty: settings.difficulty, naturalBoard: settings.naturalBoard, corners: settings.corners };
  const startFromSetup = (mode: SetupMode, choice: MatchChoice) => {
    setSetupFor(null);
    setSettings((s) => ({ ...s, ...choice }));
    if (mode === "online") setLobby({ kind: "host", setup: { naturalBoard: choice.naturalBoard, corners: choice.corners } });
    else start(mode, choice);
  };

  const start = (mode: Mode, choice: MatchChoice) => {
    const m = newMatch(mode, choice.difficulty, { naturalBoard: choice.naturalBoard, corners: choice.corners });
    saveMatch(m);
    setSaved(m);
    setMatch(m);
    setScreen("game");
  };

  const resume = () => {
    if (!saved) return;
    setMatch(saved);
    setScreen("game");
  };

  const toTitle = () => {
    setSaved(loadMatch());
    setSavedOnline(loadSession());
    setMatch(null);
    setOnline(null);
    setScreen("title");
  };

  const startOnline = useCallback((s: Session, m: MatchState) => {
    setLobby(null);
    setOnline(s);
    setMatch(m);
    setScreen("game");
  }, []);

  const rejoin = async () => {
    if (!savedOnline) return;
    const s = savedOnline;
    try {
      const room = await readSession(s);
      if (!room || room.left) {
        saveSession(null);
        setSavedOnline(null);
        setNotice("That online game has ended.");
        return;
      }
      if (s.me === "p1" && !room.guest) setLobby({ kind: "host", session: s });
      else startOnline(s, fixMatch(room.match));
    } catch {
      setNotice("Couldn't reach the server. Check your connection.");
    }
  };

  return (
    <div className="app">
      {screen === "title" || !match ? (
        <Title
          look={looks.p1}
          saved={saved}
          savedOnline={savedOnline}
          notice={notice}
          onPlay={() => setSetupFor("cpu")}
          onPlay2={() => setSetupFor("pvp")}
          onHost={() => {
            setNotice(null);
            setSetupFor("online");
          }}
          onJoin={() => {
            setNotice(null);
            setLobby({ kind: "join" });
          }}
          onRejoin={() => void rejoin()}
          onResume={resume}
          onLocker={() => setLocker("p1")}
          onHelp={() => setHelp(true)}
        />
      ) : (
        <Game
          key={`${online?.code ?? "local"}-${match.startedAt}`}
          initial={match}
          online={online ?? undefined}
          onRoomMatch={setMatch}
          settings={settings}
          onSettings={setSettings}
          looks={looks}
          onLocker={() => setLocker("p1")}
          onHelp={() => setHelp(true)}
          onRematch={(finished) => {
            // Same mode, opponent and board as the match that just ended; the loser shoots first.
            const m = newMatch(finished.mode, finished.difficulty, setupOf(finished), finished.winner ? other(finished.winner) : "p1");
            saveMatch(m);
            setMatch(m);
          }}
          onExit={toTitle}
        />
      )}
      {locker && <Locker slot={locker} onSlot={setLocker} looks={looks} onChange={setLooks} onClose={() => setLocker(null)} />}
      {help && <HelpPanel onClose={() => setHelp(false)} />}
      {setupFor && (
        <MatchSetup mode={setupFor} initial={lastChoice} onStart={(c) => startFromSetup(setupFor, c)} onClose={() => setSetupFor(null)} />
      )}
      {lobby && (
        <Lobby
          {...lobby}
          look={looks.p1}
          onReady={startOnline}
          onClose={() => {
            setLobby(null);
            setSavedOnline(loadSession());
          }}
        />
      )}
      <UpdatePrompt />
    </div>
  );
}
