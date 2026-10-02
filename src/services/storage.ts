import { openDB } from "idb";
import type { Workspace } from "../types";
const db = openDB("agronorte-sandia", 1, {
  upgrade(database) {
    database.createObjectStore("workspace");
    database.createObjectStore("files");
    database.createObjectStore("drafts");
  },
});
export async function readWorkspace(
  key: string,
): Promise<Workspace | undefined> {
  return (await db).get("workspace", key);
}
export async function saveWorkspace(key: string, state: Workspace) {
  await (await db).put("workspace", state, key);
}
export async function saveFile(id: string, file: Blob) {
  await (await db).put("files", file, id);
}
export async function getFile(id: string): Promise<Blob | undefined> {
  return (await db).get("files", id);
}
export async function saveDraft(key: string, value: unknown) {
  await (await db).put("drafts", value, key);
}
export async function readDraft<T>(key: string): Promise<T | undefined> {
  return (await db).get("drafts", key);
}
export async function clearDraft(key: string) {
  await (await db).delete("drafts", key);
}

// Delete only the legacy demonstration, never authenticated or real local workspaces.
export async function removeLegacyDemo() {
  const database = await db;
  const legacy = (await database.get("workspace", "demo")) as
    Workspace | undefined;
  const tx = database.transaction(
    ["workspace", "files", "drafts"],
    "readwrite",
  );
  await tx.objectStore("workspace").delete("demo");
  for (const attachment of legacy?.data.attachments ?? []) {
    await tx.objectStore("files").delete(attachment.id);
  }
  const drafts = tx.objectStore("drafts");
  for (const key of await drafts.getAllKeys()) {
    if (String(key).startsWith("10000000-0000-4000-8000-000000000001:demo:")) {
      await drafts.delete(key);
    }
  }
  await tx.done;
}
