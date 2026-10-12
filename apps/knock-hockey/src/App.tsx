import { useCallback, useEffect, useState } from "react";
import { loadMatch, loadSettings, newMatch, saveMatch, saveSettings, type MatchState, type Mode, type Settings } from "./game/match";
import { loadLook, saveLook, type LookSlot, type StickLook } from "./game/stick";
import { setSoundEnabled } from "./game/sound";
import { Game } from "./ui/Game";
import { Title } from "./ui/Title";
import { Locker } from "./ui/Locker";
import { HelpPanel } from "./ui/HelpPanel";
import { UpdatePrompt } from "./ui/UpdatePrompt";
import { Lobby, type LobbyProps } from "./ui/Lobby";
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
  const [lobby, setLobby] = useState<Pick<LobbyProps, "kind" | "session" | "code"> | null>(() => {
    const code = takeJoinCode();
    return code ? { kind: "join", code } : null;
  });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);
  useEffect(() => saveLook("p1", looks.p1), [looks.p1]);
  useEffect(() => saveLook("p2", looks.p2), [looks.p2]);

  const start = (mode: Mode) => {
    const m = newMatch(mode, settings.difficulty);
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
          difficulty={settings.difficulty}
          onDifficulty={(difficulty) => setSettings((s) => ({ ...s, difficulty }))}
          look={looks.p1}
          saved={saved}
          savedOnline={savedOnline}
          notice={notice}
          onPlay={() => start("cpu")}
          onPlay2={() => start("pvp")}
          onHost={() => {
            setNotice(null);
            setLobby({ kind: "host" });
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
          onRematch={() => {
            // Same mode and opponent as the match that just ended.
            const m = newMatch(match.mode, match.difficulty);
            saveMatch(m);
            setMatch(m);
          }}
          onExit={toTitle}
        />
      )}
      {locker && <Locker slot={locker} onSlot={setLocker} looks={looks} onChange={setLooks} onClose={() => setLocker(null)} />}
      {help && <HelpPanel onClose={() => setHelp(false)} />}
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
