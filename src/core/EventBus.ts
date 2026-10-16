/** Tiny typed pub/sub. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (payload: never) => void);
    return () => set!.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    this.handlers.get(type)?.forEach((h) => (h as (p: Events[K]) => void)(payload));
  }
}
