import { apiFetch, apiJson, purgeCreatedSince } from "./app";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const STATE = path.join(__dirname, ".uat-state.json");

/** Remembers when the run started and the user's settings so teardown can leave the system as it found it. */
export async function setup(): Promise<void> {
  const settings = await apiJson<Record<string, string>>("/api/settings");
  writeFileSync(STATE, JSON.stringify({ startedAt: new Date(Date.now() - 2000).toISOString(), settings }));
}

export async function teardown(): Promise<void> {
  const { startedAt, settings } = JSON.parse(readFileSync(STATE, "utf8")) as { startedAt: string; settings: Record<string, string> };
  const purged = await purgeCreatedSince(startedAt);
  const current = await apiJson<Record<string, string>>("/api/settings");
  for (const key of Object.keys(current)) {
    if (!(key in settings)) await apiFetch(`/api/settings/${key}`, { method: "DELETE" });
  }
  for (const [key, value] of Object.entries(settings)) {
    await apiFetch(`/api/settings/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
  }
  console.log(`UAT teardown: removed ${purged.documents} documents and ${purged.clipboard} clipboard items, settings restored`);
}

export default setup;
