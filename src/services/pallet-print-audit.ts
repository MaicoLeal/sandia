import type { Workspace } from "../types";
import { clearDraft, readDraftEntries, saveDraft } from "./storage";
import { loadProfile, supabase, WorkspaceAccessError } from "./supabase";

interface PrintIntent {
  userId: string;
  organizationId: string;
  palletId: string;
  printId: string;
  status?: "blocked";
  error?: string;
}
const flushing = new Set<string>();
const prefix = (organizationId: string, userId: string) =>
  `${organizationId}:label-print:${userId}:`;

// Printing never waits for a network request. The server accepts each intent
// once, so a interrupted response can be retried without duplicate audit logs.
export async function queuePalletPrint(workspace: Workspace, palletId: string) {
  if (!workspace.profile) throw new WorkspaceAccessError("Inicie sesión.");
  const printId = crypto.randomUUID();
  const intent: PrintIntent = {
    userId: workspace.profile.user_id,
    organizationId: workspace.organizationId,
    palletId,
    printId,
  };
  await saveDraft(
    prefix(intent.organizationId, intent.userId) + printId,
    intent,
  );
  if (navigator.onLine)
    void flushPalletPrints(intent.organizationId, intent.userId);
}

export async function flushPalletPrints(
  organizationId: string,
  userId: string,
) {
  const scope = prefix(organizationId, userId);
  if (!supabase || !navigator.onLine || flushing.has(scope)) return;
  flushing.add(scope);
  try {
    for (;;) {
      const intents = (await readDraftEntries<PrintIntent>(scope)).filter(
        (entry) => entry.value.status !== "blocked",
      );
      if (!intents.length) return;
      for (const entry of intents) {
        const profile = await loadProfile();
        if (
          profile.user_id !== userId ||
          profile.organization_id !== organizationId ||
          !["administrador", "gestor", "packing"].includes(profile.role)
        )
          return;
        if (
          entry.value.userId !== userId ||
          entry.value.organizationId !== organizationId
        )
          return;
        const { error } = await supabase
          .rpc("record_pallet_label_print", {
            target_pallet_id: entry.value.palletId,
            print_id: entry.value.printId,
          })
          .abortSignal(AbortSignal.timeout(8000));
        if (error) {
          if (
            error.code === "P0001" &&
            /pallet cancelado|Pallet no disponible|Identificador de impresión ya utilizado/i.test(
              error.message,
            )
          ) {
            await saveDraft(entry.key, {
              ...entry.value,
              status: "blocked",
              error: error.message,
            });
            continue;
          }
          return;
        }
        await clearDraft(entry.key);
      }
    }
  } catch {
    // Keep the intention for the next login/online event. This is an audit
    // request, not confirmation that paper physically left the printer.
  } finally {
    flushing.delete(scope);
  }
}
