import "server-only";
import { aiConcurrencySchema } from "@/contracts/ai-providers";

type WaitingRequest = {
  limit: number;
  signal?: AbortSignal;
  abort: () => void;
  grant: (release: () => void) => void;
  reject: (reason: unknown) => void;
};

// Shared by provider model instances within one Worker process. Active requests
// retain their snapshot limits; a lower limit waits for existing work to drain.
export class ProviderConcurrencyLimiter {
  private active = new Set<WaitingRequest>();
  private waiting: WaitingRequest[] = [];

  async run<T>(limit: number, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    aiConcurrencySchema.parse(limit);
    signal?.throwIfAborted();
    const release = await new Promise<() => void>((grant, reject) => {
      const ticket: WaitingRequest = {
        limit,
        signal,
        grant,
        reject,
        abort: () => {
          const index = this.waiting.indexOf(ticket);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          signal?.removeEventListener("abort", ticket.abort);
          reject(signal?.reason);
          this.drain();
        },
      };
      this.waiting.push(ticket);
      signal?.addEventListener("abort", ticket.abort, { once: true });
      this.drain();
    });
    try {
      signal?.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  }

  private drain() {
    while (this.waiting.length) {
      const ticket = this.waiting[0];
      const limit = Math.min(ticket.limit, ...Array.from(this.active, (item) => item.limit));
      if (this.active.size >= limit) return;
      this.waiting.shift();
      ticket.signal?.removeEventListener("abort", ticket.abort);
      this.active.add(ticket);
      ticket.grant(() => {
        this.active.delete(ticket);
        this.drain();
      });
    }
  }
}

const registry = new Map<string, ProviderConcurrencyLimiter>();
export function providerConcurrencyLimiter(key: string) {
  let limiter = registry.get(key);
  if (!limiter) {
    limiter = new ProviderConcurrencyLimiter();
    registry.set(key, limiter);
  }
  return limiter;
}
