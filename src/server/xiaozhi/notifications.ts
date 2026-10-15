import "server-only";
import { Client } from "pg";
import { getEnv } from "@/server/config/env";

type Change = { userId: string; id: string };
type Subscriber = { change: (change: Change) => void; error: () => void };
type Hub = { client: Client; ready: Promise<void>; subscribers: Set<Subscriber> };
const globalHub = globalThis as typeof globalThis & { xiaozhiHub?: Hub };
export async function subscribeXiaozhi(change: Subscriber["change"], error: Subscriber["error"]) {
  if (!globalHub.xiaozhiHub) {
    const connectionString = getEnv().DATABASE_URL;
    const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
    const client = new Client({
      connectionString,
      application_name: "oh-my-paper-xiaozhi",
      keepAlive: true,
      connectionTimeoutMillis: 5000,
    });
    const hub: Hub = { client, ready: Promise.resolve(), subscribers: new Set() };
    globalHub.xiaozhiHub = hub;
    const fail = () => {
      if (globalHub.xiaozhiHub !== hub) return;
      globalHub.xiaozhiHub = undefined;
      for (const subscriber of hub.subscribers) subscriber.error();
      hub.subscribers.clear();
      void client.end().catch(() => {});
    };
    client.on("error", fail);
    client.on("end", fail);
    client.on("notification", ({ channel, payload }) => {
      if (channel !== "omp_xiaozhi" || !payload) return;
      try {
        const data = JSON.parse(payload);
        if (
          data.schema === schema &&
          typeof data.userId === "string" &&
          typeof data.id === "string"
        )
          for (const subscriber of hub.subscribers) subscriber.change(data);
      } catch {
        /* Invalid notifications are ignored. */
      }
    });
    hub.ready = client
      .connect()
      .then(() => client.query("LISTEN omp_xiaozhi"))
      .then(() => {});
  }
  const hub = globalHub.xiaozhiHub;
  const subscriber = { change, error };
  hub.subscribers.add(subscriber);
  const unsubscribe = () => {
    hub.subscribers.delete(subscriber);
    if (!hub.subscribers.size && globalHub.xiaozhiHub === hub) {
      globalHub.xiaozhiHub = undefined;
      void hub.client.end().catch(() => {});
    }
  };
  try {
    await hub.ready;
  } catch (cause) {
    unsubscribe();
    throw cause;
  }
  return unsubscribe;
}
