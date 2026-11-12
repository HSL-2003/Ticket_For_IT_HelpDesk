/**
 * In-Memory LRU Cache with TTL support and Epoch Invalidation Guard
 * Zero-dependency RAM-backed cache engine for IT HelpDesk System.
 */
class MemoryCache {
  constructor(max = 500) {
    this.max = max;
    this.cache = new Map();
    this.lastInvalidatedAt = 0;
    this.prefixInvalidatedAt = new Map();
  }

  /**
   * Retrieves an entry from cache if unexpired and refreshes its LRU position.
   * Returns a deep-cloned value to prevent callers from mutating cached entries.
   *
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }

    const entry = this.cache.get(key);
    const now = Date.now();

    // Check TTL expiration
    if (entry.expiresAt && now > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU position by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    // Return cloned value for mutation isolation
    if (entry.value !== null && typeof entry.value === 'object') {
      try {
        if (typeof structuredClone === 'function') {
          return structuredClone(entry.value);
        }
        return JSON.parse(JSON.stringify(entry.value));
      } catch (e) {
        return entry.value;
      }
    }

    return entry.value;
  }

  /**
   * Stores a value in cache with TTL and validates against Epoch Invalidation Guard.
   *
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlSeconds=60]
   * @param {number} [fetchStartTime=null] Timestamp when the underlying DB read began
   * @returns {boolean} True if stored, false if rejected by epoch invalidation guard
   */
  set(key, value, ttlSeconds = 60, fetchStartTime = null) {
    const now = Date.now();

    // Epoch Invalidation Guard: Discard stale read results
    if (fetchStartTime && fetchStartTime < this.lastInvalidatedAt) {
      return false;
    }

    if (fetchStartTime) {
      for (const [prefix, time] of this.prefixInvalidatedAt.entries()) {
        if (key.startsWith(prefix) && fetchStartTime < time) {
          return false;
        }
      }
    }

    // Update existing key or evict least recently used (first element in Map)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    const expiresAt = (typeof ttlSeconds === 'number' && ttlSeconds > 0)
      ? now + (ttlSeconds * 1000)
      : null;

    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: now
    });

    return true;
  }

  /**
   * Invalidates all cache keys starting with the specified prefix
   * @param {string} prefix
   */
  invalidatePrefix(prefix) {
    const now = Date.now();
    this.lastInvalidatedAt = now;
    this.prefixInvalidatedAt.set(prefix, now);

    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidates a specific cache key
   * @param {string} key
   */
  invalidate(key) {
    this.lastInvalidatedAt = Date.now();
    this.cache.delete(key);
  }

  /**
   * Clears all cache entries and resets invalidation state
   */
  clear() {
    this.lastInvalidatedAt = Date.now();
    this.prefixInvalidatedAt.clear();
    this.cache.clear();
  }

  /**
   * Checks if a key exists and is unexpired
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Returns current count of cached items
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }
}

// Global singleton instance
const defaultCache = new MemoryCache(500);
defaultCache.MemoryCache = MemoryCache;

module.exports = defaultCache;

