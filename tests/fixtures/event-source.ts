import { vi } from "vitest";
import type { AiProgressSnapshot } from "@/contracts/ai-progress";

export class MockEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];
  readyState = MockEventSource.OPEN;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    super();
    MockEventSource.instances.push(this);
  }
  snapshot(data: AiProgressSnapshot) {
    this.dispatchEvent(new MessageEvent("snapshot", { data: JSON.stringify(data) }));
  }
  static get current() {
    return MockEventSource.instances.at(-1)!;
  }
  static install() {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  }
}
