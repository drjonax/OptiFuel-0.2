import { useEffect, useRef, useState } from "react";

type Props = {
  scrubTime: number;
  maxTime: number;
  disabled?: boolean;
  onScrub: (value: number) => void;
};

export function useTimelinePlayback({ scrubTime, maxTime, disabled, onScrub }: Props) {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || disabled) {
      return;
    }
    timerRef.current = window.setInterval(() => {
      onScrub(scrubTime >= maxTime ? 0 : scrubTime + Math.max(30, Math.floor(maxTime / 100)));
      if (scrubTime >= maxTime) {
        setPlaying(false);
      }
    }, 400);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [playing, disabled, scrubTime, maxTime, onScrub]);

  const step = (delta: number) => {
    const next = Math.min(maxTime, Math.max(0, scrubTime + delta));
    onScrub(next);
  };

  return { playing, setPlaying, step };
}
