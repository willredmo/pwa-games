// Big announcement over the board ("Round 3", "You held the row!").
export type BannerTone = "neutral" | "win" | "lose" | "draw";

export interface RoundBannerProps {
  /** Text to show; null shows nothing. */
  message: string | null;
  tone: BannerTone;
  /** Bump to replay the animation even when the message is unchanged. */
  nonce: number;
  /** A smaller second line (what a synergy does). A banner with one stays up longer, to be read. */
  sub?: string | null;
}

export function RoundBanner({ message, tone, nonce, sub }: RoundBannerProps) {
  if (!message) return null;
  return (
    <div className="banner" aria-live="polite">
      <div key={nonce} className={`banner__text banner__text--${tone}${sub ? " banner__text--long" : ""}`}>
        {withEmoji(message)}
        {sub && <span className="banner__sub">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * The banner's gradient is painted through its text (`background-clip: text`),
 * which turns colour emoji into flat blobs; each emoji gets a span that opts out.
 */
function withEmoji(text: string) {
  return text.split(/(\p{Extended_Pictographic}️?)/u).map((part, i) =>
    i % 2 ? (
      <span key={i} className="banner__emoji">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
