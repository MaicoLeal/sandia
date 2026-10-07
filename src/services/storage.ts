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
function sameStoredWorkspace(a: Workspace | undefined, b: Workspace) {
  return (
    a?.organizationId === b.organizationId &&
    a?.profile?.user_id === b.profile?.user_id &&
    a?.revision === b.revision &&
    a?.pending === b.pending &&
    JSON.stringify(a?.data) === JSON.stringify(b.data)
  );
}
// The archive and replacement commit together. A second tab's new local work
// causes the entire transaction to abort instead of overwriting its changes.
export async function archiveWorkspaceAndReplace(
  key: string,
  before: Workspace,
  after: Workspace,
) {
  const database = await db;
  const tx = database.transaction(
    ["workspace", "files", "drafts"],
    "readwrite",
  );
  const current = (await tx.objectStore("workspace").get(key)) as
    Workspace | undefined;
  if (!sameStoredWorkspace(current, before)) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error(
      "Los registros locales cambiaron en otra pestaña. Compare nuevamente antes de actualizar.",
    );
  }
  const files: { id: string; file: Blob }[] = [];
  for (const attachment of before.data.attachments) {
    const file = (await tx.objectStore("files").get(attachment.id)) as
      Blob | undefined;
    if (file) files.push({ id: attachment.id, file });
  }
  const draftStore = tx.objectStore("drafts");
  const drafts: { key: string; value: unknown }[] = [];
  for (const draftKey of await draftStore.getAllKeys())
    if (String(draftKey).startsWith(before.organizationId + ":"))
      drafts.push({
        key: String(draftKey),
        value: await draftStore.get(draftKey),
      });
  const archiveKey = `recovery:${key}:${new Date().toISOString()}:${crypto.randomUUID()}`;
  await tx.objectStore("workspace").put(
    {
      workspace: before,
      files,
      drafts,
      archivedAt: new Date().toISOString(),
    },
    archiveKey,
  );
  await tx.objectStore("workspace").put(after, key);
  await tx.done;
  return archiveKey;
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
