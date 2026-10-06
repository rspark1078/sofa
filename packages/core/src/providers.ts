import verifiedLinks from "./verified-provider-links.json";

/**
 * Generate a watch URL for a provider using its URL template.
 * Templates use {title} as a placeholder for the URL-encoded title name.
 */
export function generateProviderUrl(urlTemplate: string | null, titleName: string): string | null {
  if (!urlTemplate) return null;
  try {
    const url = new URL(urlTemplate.replace("{title}", encodeURIComponent(titleName)));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

// Curated official title pages; never infer playback URLs from a title slug.
export function getProviderWatchLink(options: {
  tmdbId: number;
  type: "movie" | "tv";
  providerIds: number[];
  titleName: string;
  urlTemplate: string | null;
}): { watchUrl: string | null; linkType: "title" | "search" | "landing" } {
  const verified = verifiedLinks.find(
    (link) =>
      link.tmdbId === options.tmdbId &&
      link.type === options.type &&
      options.providerIds.includes(link.providerId),
  );
  if (verified) return { watchUrl: verified.url, linkType: "title" };
  return {
    watchUrl: generateProviderUrl(options.urlTemplate, options.titleName),
    linkType: options.urlTemplate?.includes("{title}") ? "search" : "landing",
  };
}
