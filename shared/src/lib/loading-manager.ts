// A tiny global loading-state registry.
//
// Components/services flip named loading flags (e.g. 'auth', 'profile') and any
// subscriber (see `useGlobalLoading`) is notified with the latest snapshot.

export type LoadingStates = Record<string, boolean>;
export type LoadingListener = (states: LoadingStates) => void;

class LoadingManager {
  private states: LoadingStates = {};
  private listeners = new Set<LoadingListener>();

  /** Set or clear a named loading flag and notify subscribers. */
  setLoading(key: string, loading: boolean): void {
    if (loading) {
      this.states[key] = true;
    } else {
      delete this.states[key];
    }
    this.notify();
  }

  /** Clear all loading flags (e.g. on logout). */
  clear(): void {
    if (Object.keys(this.states).length === 0) return;
    this.states = {};
    this.notify();
  }

  /** Whether a specific key is currently loading. */
  isLoading(key: string): boolean {
    return Boolean(this.states[key]);
  }

  /** Snapshot of all current loading flags. */
  getStates(): LoadingStates {
    return { ...this.states };
  }

  /**
   * Subscribe to loading-state changes. The listener is invoked immediately
   * with the current snapshot. Returns an unsubscribe function.
   */
  subscribe(listener: LoadingListener): () => void {
    this.listeners.add(listener);
    listener(this.getStates());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getStates();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

// Single shared instance used across the app.
export const globalLoadingManager = new LoadingManager();
