// Big announcement over the board ("Round 3", "You held the row!").
export type BannerTone = "neutral" | "win" | "lose" | "draw";

export interface RoundBannerProps {
  /** Text to show; null shows nothing. */
  message: string | null;
  tone: BannerTone;
  /** Bump to replay the animation even when the message is unchanged. */
  nonce: number;
}

export function RoundBanner({ message, tone, nonce }: RoundBannerProps) {
  if (!message) return null;
  return (
    <div className="banner" aria-live="polite">
      <div key={nonce} className={`banner__text banner__text--${tone}`}>
        {message}
      </div>
    </div>
  );
}
