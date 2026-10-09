export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel help" role="dialog" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2>How to play</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <h3>The goal</h3>
        <p>
          Knock the puck into the CPU's goal at the top. You defend the blue goal at the bottom. First to <b>10</b> wins.
        </p>
        <p>
          In <b>2 Players</b>, pass the device: Blue shoots up from the bottom, Red shoots down from the top, same
          controls. Each player's stick is set in the Locker.
        </p>
        <p>
          <b>Online:</b> tap Online game and share the code or link; your friend taps Join with code. Each of you sees
          your own goal at the bottom, and you watch each other line up live.
        </p>
        <h3>Taking a shot</h3>
        <ol>
          <li><b>Power:</b> touch or drag the power bar beside the board. Higher up is a soft tap, lower down hits harder. The stick pulls back to match.</li>
          <li><b>Aim:</b> use the ↺ ↻ buttons under the board (or ← → on a keyboard). Tap for a tiny turn; hold to swing round, faster the longer you hold.</li>
          <li><b>Hit:</b> tap 🏒 Hit! It's the only way to shoot, so set power and aim in any order and take your time. Every hit wobbles a touch, so even a perfect shot isn't guaranteed.</li>
        </ol>
        <p>
          <b>Keyboard:</b> ← → aim, ↑ ↓ power (hold either to keep going), Space to hit.
        </p>
        <h3>Turns</h3>
        <p>
          You take turns, one hit each, and you can hit the puck wherever it stopped. Knock it into your own goal and
          the other side scores. After a goal the puck goes back to centre ice and whoever was scored on hits first.
        </p>
        <h3>The board</h3>
        <p>
          A diamond block guards each goal, so straight shots rarely go in. Bank it off the rails instead, or try the
          classic: from beside a side rail, hit straight up into the corner wedge. It glances off, slips behind the
          diamond and into the goal.
        </p>
      </div>
    </div>
  );
}
