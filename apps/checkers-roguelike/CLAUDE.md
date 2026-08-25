# Checkers Roguelike

Single-player-first roguelike built on standard checkers rules. Roguelike
elements come entirely from picks made between floors — the core checkers
engine itself stays standard, generalized to support variable board size/shape.

## Run structure
- 10-floor ladder. Each floor is a full checkers match against an AI opponent.
- Single loss ends the run — no lives/retries for v1.
- Board size grows across 3 tiers as the ladder progresses:
  - Floors 1-3: 6x6
  - Floors 4-7: 8x8 (standard)
  - Floors 8-10: 10x10
- AI gets harder per floor, primarily via deeper search/lookahead. AI may
  also receive random upgrades/picks similar to the player, for v1.

## Starting setup
- Player begins each run with 4 basic pieces (not a full standard checkers set).

## Board mutations (v1 scope)
- Size: per the 3-tier progression above.
- Shape: rectangular variants only for v1 — some floors roll a wider or
  longer board instead of a standard square (e.g. 10x6, 6x10) at that
  floor's size tier.
- Deferred (not v1): hazard squares, notched corners, hourglass/diamond
  shapes, asymmetric start rows.

## Piece upgrades
- Offered as a pick-1-of-3 choice between floors, on winning a floor.
- Player chooses which of their existing pieces receives the upgrade.
- Upgrade pool (v1):
  - **Backward strike** — capture backward without being crowned
  - **Long leap** — jump two squares in a single capture move
  - **Fortified** — can't be captured the first time it's attacked (one-time shield)
  - **Swift** — can move (not capture) two squares instead of one
  - **Early king** — crowned immediately, gains king movement
  - **Double strike** — can chain-capture across non-adjacent diagonals
  - **Guardian** — adjacent friendly pieces can't be captured while this
    piece is on the board
  - **Phantom step** — once per match, this piece can take an extra move

## Implementation notes
- Build move/capture logic generically off row/col bounds from the start —
  do not hard-code 8x8. Non-square and variable-size boards are core to v1,
  not a later add-on.
- Win a floor → advance + upgrade pick. Lose → run ends immediately.

## Open questions (not yet decided)
- Exact AI difficulty curve per floor (search depth values) — needs
  playtesting once the engine works.
- Which floors roll shape mutations vs. standard square boards, and whether
  that's a fixed schedule or randomized.
