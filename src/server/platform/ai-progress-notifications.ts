import "server-only";
import { Client } from "pg";
import { getEnv } from "@/server/config/env";

type Change = { kind: "job"; userId: string; id: string } | { kind: "models" | "search" };
type Subscriber = { change: (change: Change) => void; error: () => void };
type Hub = { client: Client; ready: Promise<void>; subscribers: Set<Subscriber> };
const globalHub = globalThis as typeof globalThis & { paperAiProgressHub?: Hub };

function createHub(): Hub {
  const connectionString = getEnv().DATABASE_URL;
  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  const client = new Client({
    connectionString,
    application_name: "oh-my-paper-ai-progress",
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    keepAlive: true,
  });
  const hub: Hub = { client, ready: Promise.resolve(), subscribers: new Set() };
  const fail = () => {
    if (globalHub.paperAiProgressHub !== hub) return;
    globalHub.paperAiProgressHub = undefined;
    for (const subscriber of hub.subscribers) subscriber.error();
    hub.subscribers.clear();
    void client.end().catch(() => {});
  };
  client.on("error", fail);
  client.on("end", fail);
  client.on("notification", (notification) => {
    if (notification.channel !== "omp_ai_progress" || !notification.payload) return;
    let change;
    try {
      change = JSON.parse(notification.payload);
    } catch {
      return;
    }
    if (!change || change.schema !== schema) return;
    if (
      change.kind !== "models" &&
      change.kind !== "search" &&
      !(change.kind === "job" && typeof change.userId === "string" && typeof change.id === "string")
    )
      return;
    for (const subscriber of hub.subscribers) subscriber.change(change);
  });
  hub.ready = client
    .connect()
    .then(() => client.query("LISTEN omp_ai_progress"))
    .then(() => {});
  return hub;
}

/** One dedicated LISTEN connection per Web process, shared by all SSE requests. */
export async function subscribeAiProgress(
  change: Subscriber["change"],
  error: Subscriber["error"],
) {
  const hub = (globalHub.paperAiProgressHub ??= createHub());
  const subscriber = { change, error };
  hub.subscribers.add(subscriber);
  const unsubscribe = () => {
    hub.subscribers.delete(subscriber);
    if (hub.subscribers.size || globalHub.paperAiProgressHub !== hub) return;
    globalHub.paperAiProgressHub = undefined;
    void hub.client.end().catch(() => {});
  };
  try {
    await hub.ready;
  } catch (cause) {
    unsubscribe();
    throw cause;
  }
  return unsubscribe;
}
