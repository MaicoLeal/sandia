import { day } from "./domain";
import type { ReceptionCreationValues } from "./reception-creation";

export type ReceptionDraft = ReceptionCreationValues & {
  pendingWeight?: string;
};

export function freshReceptionValues(
  producerId: string,
  responsible: string,
  allowSelection: boolean,
  receptionDate = day(),
): ReceptionCreationValues {
  return {
    producerId,
    plotId: "",
    lotId: "",
    lotCode: "",
    date: receptionDate,
    harvest: "",
    responsible,
    notes: "",
    weights: [],
    classifyNow: allowSelection,
    rejectedKg: "0",
    rejectionReason: "",
    region: "",
    pestObservation: "",
    symptoms: "",
    photos: [],
  };
}

export function hasReceptionDraft(draft: ReceptionDraft | undefined) {
  return Boolean(
    draft &&
    (draft.producerId ||
      draft.plotId ||
      draft.lotId ||
      draft.lotCode?.trim() ||
      draft.harvest ||
      draft.weights?.length ||
      draft.photos?.length ||
      draft.pendingWeight?.trim() ||
      draft.notes?.trim() ||
      Number(draft.rejectedKg?.replace(",", ".")) > 0 ||
      draft.rejectionReason ||
      draft.region?.trim() ||
      draft.pestObservation?.trim() ||
      draft.symptoms?.trim()),
  );
}

export function restoreReceptionDraft(
  defaults: ReceptionCreationValues,
  draft: ReceptionDraft,
): ReceptionCreationValues {
  // Keep the draft's dates and weights exactly as entered. Resuming is explicit;
  // a new delivery instead starts from freshReceptionValues.
  return {
    ...defaults,
    ...draft,
    weights: [...(draft.weights ?? [])],
    photos: [...(draft.photos ?? [])],
  };
}

export function changeReceptionProducer(
  values: ReceptionCreationValues,
  producerId: string,
): ReceptionCreationValues {
  return {
    ...values,
    producerId,
    plotId: "",
    lotId: "",
    lotCode: "",
    harvest: "",
  };
}
