export function providerFirefoxUrl(watchUrl: string): string | null {
  try {
    const url = new URL(watchUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return "sofa-firefox:" + encodeURIComponent(url.href);
  } catch {
    return null;
  }
}
