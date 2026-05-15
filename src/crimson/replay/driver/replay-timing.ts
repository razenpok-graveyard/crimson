// Port of crimson/replay/driver/replay_timing.py

export function shouldApplyWorldDtStepsForReplay(
  opts: { originalCaptureReplay: boolean },
): boolean {
  const _ = opts.originalCaptureReplay;
  return true;
}
