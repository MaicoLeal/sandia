import { describe, expect, it } from "vitest";
import {
  changeReceptionProducer,
  freshReceptionValues,
  hasReceptionDraft,
  restoreReceptionDraft,
} from "./reception-draft";

describe("borradores de nuevas entregas", () => {
  it("empieza otro recibimiento del mismo productor sin arrastrar lote, cosecha ni peso", () => {
    const old = {
      ...freshReceptionValues("producer", "Piris", true, "2026-10-07"),
      lotId: "old-lot",
      lotCode: "07102026",
      harvest: "2026-10-03",
      weights: [108, 381],
      rejectedKg: "7",
    };
    const next = freshReceptionValues(
      old.producerId,
      "Piris",
      true,
      "2026-10-12",
    );
    expect(next).toMatchObject({
      producerId: "producer",
      date: "2026-10-12",
      lotId: "",
      lotCode: "",
      harvest: "",
      weights: [],
      rejectedKg: "0",
    });
    expect(old.weights).toEqual([108, 381]);
    expect(old.date).toBe("2026-10-07");
  });

  it("distingue un borrador vacío de trabajo que requiere elegir si retomar", () => {
    const blank = freshReceptionValues("", "Piris", true, "2026-10-07");
    expect(hasReceptionDraft(blank)).toBe(false);
    expect(hasReceptionDraft(undefined)).toBe(false);
    expect(hasReceptionDraft({ ...blank, producerId: "producer" })).toBe(true);
    expect(hasReceptionDraft({ ...blank, pendingWeight: "390,5" })).toBe(true);
    expect(hasReceptionDraft({ ...blank, weights: [390] })).toBe(true);
    expect(hasReceptionDraft({ ...blank, notes: "Carga por terminar" })).toBe(
      true,
    );
    expect(hasReceptionDraft({ ...blank, rejectedKg: "0,5" })).toBe(true);
    expect(
      hasReceptionDraft({
        ...blank,
        photos: [
          { id: "photo", name: "Fruta.jpg", mime: "image/jpeg", size: 125 },
        ],
      }),
    ).toBe(true);
  });

  it("retoma expresamente las fechas antiguas y conserva el contenido del borrador", () => {
    const saved = {
      ...freshReceptionValues("producer", "Piris", true, "2026-10-07"),
      lotId: "old-lot",
      harvest: "2026-10-03",
      weights: [108, 381],
      pendingWeight: "39,5",
      photos: [
        { id: "photo", name: "Fruta.jpg", mime: "image/jpeg", size: 125 },
      ],
    };
    const restored = restoreReceptionDraft(
      freshReceptionValues("", "Leal", true, "2026-10-12"),
      saved,
    );
    expect(restored.date).toBe("2026-10-07");
    expect(restored.harvest).toBe("2026-10-03");
    expect(restored.lotId).toBe("old-lot");
    expect(restored.weights).toEqual([108, 381]);
    expect(restored.responsible).toBe("Piris");
    restored.weights.push(400);
    restored.photos.length = 0;
    expect(saved.weights).toEqual([108, 381]);
    expect(saved.photos).toHaveLength(1);
  });

  it("al cambiar de productor limpia el origen anterior y conserva las mediciones escritas", () => {
    const before = {
      ...freshReceptionValues("producer-a", "Piris", true, "2026-10-12"),
      plotId: "plot-a",
      lotId: "lot-a",
      lotCode: "LOTE-A",
      harvest: "2026-10-03",
      weights: [400, 380],
      notes: "Revisar descarga",
    };
    expect(changeReceptionProducer(before, "producer-b")).toMatchObject({
      producerId: "producer-b",
      plotId: "",
      lotId: "",
      lotCode: "",
      harvest: "",
      date: "2026-10-12",
      weights: [400, 380],
      notes: "Revisar descarga",
    });
    expect(before.lotId).toBe("lot-a");
  });
});
