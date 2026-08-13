export function mapFullscreenTooltipKey(
  isFullscreen: boolean,
): "exitFullscreen" | "fullscreen" {
  return isFullscreen ? "exitFullscreen" : "fullscreen";
}
