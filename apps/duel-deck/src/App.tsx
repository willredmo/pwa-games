import { useCallback, useEffect, useState } from "react";
import type { Difficulty } from "./game/match";
import { loadMatch, loadSettings, saveSettings, type SavedMatch, type Settings } from "./game/save";
import { setSoundEnabled, unlockSound } from "./game/sound";
import { Game } from "./ui/Game";
import { Title } from "./ui/Title";
import { Lobby, type LobbyProps } from "./ui/Lobby";
import { HelpPanel, UnitsView } from "./ui/Overlays";
import { UpdatePrompt } from "./ui/UpdatePrompt";
import { leaveRoom, loadSession, readSession, saveSession, type Session } from "./online/room";
import "./App.css";

// Screens. App owns what outlives a single match — the settings, the saved
// match, the online session, which screen is up — and `Game` owns one match
// from round 1 to the result. Starting a match mounts a fresh Game; leaving
// one unmounts it, so no match state can leak from one run into the next.

type Screen = "title" | "game";

/** What `Game` was mounted with. `key` forces a remount when this changes. */
interface Run {
  id: number;
  resume: SavedMatch | null;
  difficulty: Difficulty;
  online?: Session;
}

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
  /** The save as the title screen last read it, for the Continue button. */
  const [saved, setSaved] = useState<SavedMatch | null>(loadMatch);
  const [run, setRun] = useState<Run | null>(null);
  const [help, setHelp] = useState(false);
  const [units, setUnits] = useState(false);
  /** An online duel this device was in, offered for rejoining after a reload. */
  const [savedOnline, setSavedOnline] = useState<Session | null>(loadSession);
  const [lobby, setLobby] = useState<Pick<LobbyProps, "kind" | "session" | "code"> | null>(() => {
    const code = takeJoinCode();
    return code ? { kind: "join", code } : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const runId = useState(() => ({ n: 0 }))[0];

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);

  const start = (difficulty: Difficulty, resume: SavedMatch | null) => {
    // Audio can only start from a gesture, and this click is one.
    if (settings.sound) unlockSound();
    setSettings((s) => ({ ...s, difficulty }));
    setRun({ id: ++runId.n, resume, difficulty });
    setScreen("game");
  };

  const startOnline = useCallback(
    (s: Session) => {
      if (settings.sound) unlockSound();
      saveSession(s);
      setLobby(null);
      setNotice(null);
      setSavedOnline(s);
      setRun({ id: ++runId.n, resume: null, difficulty: settings.difficulty, online: s });
      setScreen("game");
    },
    [settings.sound, settings.difficulty, runId],
  );

  const toTitle = () => {
    // Leaving an online duel closes it for the other side too: there's no
    // half-match to come back to once one row stops committing.
    if (run?.online) {
      void leaveRoom(run.online);
      saveSession(null);
      setSavedOnline(null);
    }
    setRun(null);
    setScreen("title");
    setSaved(loadMatch()); // may have been cleared, or advanced several rounds
  };

  const rejoin = async () => {
    if (!savedOnline) return;
    try {
      const room = await readSession(savedOnline);
      if (!room || room.left) {
        saveSession(null);
        setSavedOnline(null);
        setNotice("That duel has ended.");
        return;
      }
      // A host whose guest never arrived goes back to showing the code.
      if (savedOnline.me === "p1" && !room.guest) setLobby({ kind: "host", session: savedOnline });
      else startOnline(savedOnline);
    } catch {
      setNotice("Couldn't reach the server. Check your connection.");
    }
  };

  return (
    <div className="app-root">
      {screen === "game" && run ? (
        <Game
          key={run.id}
          resume={run.resume}
          difficulty={run.difficulty}
          online={run.online}
          speed={settings.speed}
          onSpeed={(speed) => setSettings((s) => ({ ...s, speed }))}
          sound={settings.sound}
          onSound={(sound) => {
            if (sound) unlockSound();
            setSettings((s) => ({ ...s, sound }));
          }}
          onExit={toTitle}
        />
      ) : (
        <Title
          saved={saved}
          difficulty={settings.difficulty}
          onDifficulty={(difficulty) => setSettings((s) => ({ ...s, difficulty }))}
          sound={settings.sound}
          onSound={(sound) => {
            if (sound) unlockSound();
            setSettings((s) => ({ ...s, sound }));
          }}
          onPlay={() => start(settings.difficulty, null)}
          onResume={() => saved && start(saved.difficulty ?? settings.difficulty, saved)}
          onHelp={() => setHelp(true)}
          onUnits={() => setUnits(true)}
          rejoinCode={savedOnline?.code ?? null}
          notice={notice}
          onHost={() => {
            setNotice(null);
            setLobby({ kind: "host" });
          }}
          onJoin={() => {
            setNotice(null);
            setLobby({ kind: "join" });
          }}
          onRejoin={() => void rejoin()}
        />
      )}
      {lobby && (
        <Lobby
          {...lobby}
          onReady={startOnline}
          onClose={() => {
            setLobby(null);
            setSavedOnline(loadSession());
          }}
        />
      )}
      {help && <HelpPanel onClose={() => setHelp(false)} />}
      {units && <UnitsView onClose={() => setUnits(false)} />}
      <UpdatePrompt />
    </div>
  );
}
