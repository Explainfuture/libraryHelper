export interface Countdown {
  expired: boolean;
  label: string;
  remainingSeconds: number;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError("bytes must be a non-negative finite number");
  }
  if (bytes < 1024) {
    return `${Math.floor(bytes).toString()} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes;
  for (const unit of units) {
    value /= 1024;
    if (value < 1024 || unit === units.at(-1)) {
      return `${value.toFixed(1)} ${unit}`;
    }
  }
  return `${Math.floor(bytes).toString()} B`;
}

export function getCountdown(expiresAt: number, now = Date.now()): Countdown {
  const remainingMilliseconds = Math.max(0, expiresAt - now);
  const remainingSeconds = Math.ceil(remainingMilliseconds / 1000);
  if (remainingSeconds === 0) {
    return { expired: true, label: "链接已失效", remainingSeconds: 0 };
  }
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return {
    expired: false,
    label: `${minutes.toString()} 分 ${seconds.toString()} 秒`,
    remainingSeconds,
  };
}
