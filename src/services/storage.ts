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
