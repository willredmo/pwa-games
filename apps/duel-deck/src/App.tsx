import { useCallback, useEffect, useState } from "react";
import type { Difficulty, MatchRules } from "./game/match";
import { loadMatch, loadSettings, saveSettings, type SavedMatch, type Settings } from "./game/save";
import { audioContext, setSoundEnabled, unlockSound } from "./game/sound";
import { setMusic, setMusicEnabled } from "./game/music";
import { Game } from "./ui/Game";
import { Title } from "./ui/Title";
import { Lobby, type LobbyProps } from "./ui/Lobby";
import { CodexView, HelpPanel } from "./ui/Overlays";
import { UpdatePrompt } from "./ui/UpdatePrompt";
import { tutorialDone } from "./ui/Tutorial";
import { PatchNotes, hasUnseenNotes } from "./ui/PatchNotes";
import { EMPTY_DRAFT, FeedbackPanel, type FeedbackDraft } from "./ui/Feedback";
import { afterPaint, captureScreenshot } from "./game/feedback";
import { leaveRoom, loadSession, readSession, saveSession, type Session } from "./online/room";
import { setKawaii } from "./game/kawaii";
import { setBlood } from "./board/blood";
import "./App.css";

// Screens. App owns what outlives a single match — the settings, the saved
// match, the online session, which screen is up — and `Game` owns one match
// from round 1 to the result. Starting a match mounts a fresh Game; leaving
// one unmounts it, so no match state can leak from one run into the next.

type Screen = "title" | "game";

/** The title screen's match settings, as the rules a match is built with. */
const rulesFrom = (s: Settings): MatchRules => ({ startHp: s.startHp, easy: s.easy, synergies: s.synergies, upgrades: s.upgrades, levelCap: s.levelCap });

/** What `Game` was mounted with. `key` forces a remount when this changes. */
interface Run {
  id: number;
  resume: SavedMatch | null;
  difficulty: Difficulty;
  /** Settings for a fresh CPU match. */
  rules?: MatchRules;
  online?: Session;
  /** The first-match tutorial (vs Easy, never saved). */
  tutorial?: boolean;
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
  const [notes, setNotes] = useState(false);
  const [newNotes, setNewNotes] = useState(hasUnseenNotes);
  /** An online duel this device was in, offered for rejoining after a reload. */
  const [savedOnline, setSavedOnline] = useState<Session | null>(loadSession);
  const [lobby, setLobby] = useState<Pick<LobbyProps, "kind" | "session" | "code"> | null>(() => {
    const code = takeJoinCode();
    return code ? { kind: "join", code } : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  /** The open feedback form, with the screenshot taken just before it opened. */
  const [feedback, setFeedback] = useState<{ shot: string | null; context: string } | null>(null);
  /** What's typed in the form, kept across a Retake (and a Cancel, until it's sent). */
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_DRAFT);
  const runId = useState(() => ({ n: 0 }))[0];

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);
  useEffect(() => {
    setKawaii(settings.look === "kawaii");
    setBlood(settings.look === "bloody");
  }, [settings.look]);
  useEffect(() => setMusicEnabled(settings.music), [settings.music]);
  // The menu track on every screen outside a match; a match sets its own
  // track per phase.
  useEffect(() => {
    if (screen !== "game") setMusic("menu");
  }, [screen]);
  // Browsers only start audio from a gesture, and the menu has music now, so
  // the first tap anywhere unlocks it (it used to wait for Play). iOS Safari
  // doesn't count a finger's pointerdown (touchstart) as one, only the end of
  // the tap, so it listens for several and stops once audio is running.
  useEffect(() => {
    if (!settings.sound) return;
    const events = ["pointerdown", "touchend", "click", "keydown"] as const;
    const unlock = () => {
      unlockSound();
      if (audioContext()?.state === "running") for (const e of events) window.removeEventListener(e, unlock);
    };
    for (const e of events) window.addEventListener(e, unlock, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, unlock);
    };
  }, [settings.sound]);

  const start = (difficulty: Difficulty, resume: SavedMatch | null) => {
    // Audio can only start from a gesture, and this click is one.
    if (settings.sound) unlockSound();
    setSettings((s) => ({ ...s, difficulty }));
    setRun({ id: ++runId.n, resume, difficulty, rules: rulesFrom(settings) });
    setScreen("game");
  };

  /** The tutorial: a fresh match against Easy with the coach on. Leaves any save alone. */
  const startTutorial = () => {
    if (settings.sound) unlockSound();
    setRun({ id: ++runId.n, resume: null, difficulty: "easy", tutorial: true });
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

  /**
   * Screenshot what's on screen, then open the feedback form. Whatever opened
   * it (☰) has just been closed, so wait for that to paint away first.
   */
  const openFeedback = async (context: string) => {
    setFeedback(null);
    await afterPaint();
    const shot = await captureScreenshot();
    setFeedback({ shot, context });
  };

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
      // A rematch may have started since this device saved the session.
      const session = { ...savedOnline, match: room.match ?? 1 };
      if (session.me === "p1" && !room.guest) setLobby({ kind: "host", session });
      else startOnline(session);
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
          rules={run.rules}
          online={run.online}
          tutorial={run.tutorial}
          speed={settings.speed}
          onSpeed={(speed) => setSettings((s) => ({ ...s, speed }))}
          sound={settings.sound}
          onSound={(sound) => {
            if (sound) unlockSound();
            setSettings((s) => ({ ...s, sound }));
          }}
          music={settings.music}
          onMusic={(music) => {
            if (music && settings.sound) unlockSound();
            setSettings((s) => ({ ...s, music }));
          }}
          look={settings.look}
          onLook={(look) => setSettings((s) => ({ ...s, look }))}
          battleLog={settings.battleLog}
          onBattleLog={(battleLog) => setSettings((s) => ({ ...s, battleLog }))}
          onExit={toTitle}
          onRematch={(match) => run.online && startOnline({ ...run.online, match })}
          onFeedback={(context) => void openFeedback(context)}
        />
      ) : (
        <Title
          saved={saved}
          difficulty={settings.difficulty}
          onDifficulty={(difficulty) => setSettings((s) => ({ ...s, difficulty }))}
          rules={rulesFrom(settings)}
          onRules={(r) => setSettings((s) => ({ ...s, ...r }))}
          sound={settings.sound}
          onSound={(sound) => {
            if (sound) unlockSound();
            setSettings((s) => ({ ...s, sound }));
          }}
          music={settings.music}
          onMusic={(music) => {
            if (music && settings.sound) unlockSound();
            setSettings((s) => ({ ...s, music }));
          }}
          onPlay={() => start(settings.difficulty, null)}
          onResume={() => saved && start(saved.difficulty ?? settings.difficulty, saved)}
          onHelp={() => setHelp(true)}
          onCodex={() => setUnits(true)}
          onNotes={() => {
            setNotes(true);
            setNewNotes(false);
          }}
          newNotes={newNotes}
          onTutorial={startTutorial}
          suggestTutorial={!saved && !tutorialDone()}
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
          onFeedback={() => void openFeedback("title")}
          look={settings.look}
          onLook={(look) => setSettings((s) => ({ ...s, look }))}
        />
      )}
      {lobby && (
        <Lobby
          {...lobby}
          rules={rulesFrom(settings)}
          onReady={startOnline}
          onClose={() => {
            setLobby(null);
            setSavedOnline(loadSession());
          }}
        />
      )}
      {help && <HelpPanel onClose={() => setHelp(false)} />}
      {units && <CodexView onClose={() => setUnits(false)} />}
      {notes && <PatchNotes onClose={() => setNotes(false)} />}
      {feedback && (
        <FeedbackPanel
          shot={feedback.shot}
          context={feedback.context}
          draft={draft}
          onDraft={setDraft}
          onRetake={() => void openFeedback(feedback.context)}
          onClose={(sent) => {
            setFeedback(null);
            if (sent) setDraft(EMPTY_DRAFT);
          }}
        />
      )}
      <UpdatePrompt />
    </div>
  );
}
