export type SupportedPlatform = "macos" | "linux" | "windows";

export function detectPlatform(
  platform: NodeJS.Platform = process.platform,
): SupportedPlatform | null {
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "linux") {
    return "linux";
  }
  if (platform === "win32") {
    return "windows";
  }
  return null;
}
