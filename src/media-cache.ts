export type CachedMediaItem = { path: string; contentType?: string };

type CachedMediaBucket = {
  mediaList: CachedMediaItem[];
  expireAt: number;
};

export const CACHE_TTL_MS = 10 * 60 * 1000;

const mediaCache = new Map<string, CachedMediaBucket>();

export function cacheMedia(
  cacheKey: string,
  mediaList: CachedMediaItem[],
  now: number = Date.now(),
): void {
  if (mediaList.length === 0) {
    return;
  }

  const existing = mediaCache.get(cacheKey);
  const merged = existing ? [...existing.mediaList, ...mediaList] : [...mediaList];
  mediaCache.set(cacheKey, {
    mediaList: merged,
    expireAt: now + CACHE_TTL_MS,
  });
}

export function consumeCachedMedia(
  cacheKey: string,
  now: number = Date.now(),
): CachedMediaItem[] {
  const cached = mediaCache.get(cacheKey);
  if (!cached) {
    return [];
  }

  mediaCache.delete(cacheKey);
  if (cached.expireAt <= now) {
    return [];
  }
  return cached.mediaList;
}

export function deferOrMergeMedia(params: {
  cacheKey: string;
  text: string;
  mediaList: CachedMediaItem[];
  now?: number;
}): {
  deferred: boolean;
  mediaList: CachedMediaItem[];
  mergedCachedCount: number;
} {
  const { cacheKey, text, mediaList, now = Date.now() } = params;

  if (!text.trim()) {
    if (mediaList.length > 0) {
      cacheMedia(cacheKey, mediaList, now);
      return {
        deferred: true,
        mediaList: [],
        mergedCachedCount: 0,
      };
    }
    return {
      deferred: false,
      mediaList,
      mergedCachedCount: 0,
    };
  }

  const cachedMedia = consumeCachedMedia(cacheKey, now);
  return {
    deferred: false,
    mediaList: cachedMedia.length > 0 ? [...cachedMedia, ...mediaList] : mediaList,
    mergedCachedCount: cachedMedia.length,
  };
}
