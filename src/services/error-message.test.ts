import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./error-message";

const fallback = "Error de sincronización.";

describe("mensajes de errores de Supabase", () => {
  it.each([
    ["P0001", "Conflicto de sincronización: actualice los datos."],
    ["42501", "permission denied for table pallets"],
    ["PGRST202", "Could not find the function public.sync_workspace"],
  ])("conserva mensaje y código %s de un error plano", (code, message) => {
    expect(
      getErrorMessage(
        { code, message, details: "registro privado", hint: "dato privado" },
        fallback,
      ),
    ).toBe(`${message} (código: ${code})`);
  });

  it("conserva los errores Error y las cadenas sin incluir su stack", () => {
    const error = new Error("Sin conexión. Sus registros siguen guardados.");
    error.stack = "credenciales internas";
    expect(getErrorMessage(error, fallback)).toBe(error.message);
    expect(getErrorMessage("  Error de lectura.\n", fallback)).toBe(
      "Error de lectura.",
    );
  });

  it.each([null, undefined, 42, {}, { message: " " }, { message: 7 }])(
    "usa el mensaje alternativo para un error inválido: %j",
    (error) => {
      expect(getErrorMessage(error, fallback)).toBe(fallback);
    },
  );

  it("no lee details, hint, payload ni métodos de serialización", () => {
    const error = {
      message: "Error al guardar.",
      code: "P0001",
      get details() {
        throw new Error("No leer registros privados");
      },
      get hint() {
        throw new Error("No leer información interna");
      },
      get payload() {
        throw new Error("No leer registros privados");
      },
      toJSON() {
        throw new Error("No serializar registros privados");
      },
    };
    expect(getErrorMessage(error, fallback)).toBe(
      "Error al guardar. (código: P0001)",
    );
  });

  it("oculta credenciales reconocibles incluso dentro de message", () => {
    const result = getErrorMessage(
      {
        message:
          "Invalid Bearer secret-token; sb_secret_abcDEF123 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.signature",
      },
      fallback,
    );
    expect(result).not.toContain("secret-token");
    expect(result).not.toContain("sb_secret_abcDEF123");
    expect(result).not.toContain("eyJhbGci");
    expect(result).toContain("[oculto]");
  });

  it("limita texto excesivo y omite códigos que no sean SQL/PostgREST", () => {
    const result = getErrorMessage(
      { message: "a".repeat(2000), code: "private-access-token" },
      fallback,
    );
    expect(result).toHaveLength(1200);
    expect(result).not.toContain("private-access-token");
  });

  it("usa el mensaje alternativo si un objeto no permite leer message", () => {
    expect(
      getErrorMessage(
        {
          get message() {
            throw new Error("Getter bloqueado");
          },
        },
        fallback,
      ),
    ).toBe(fallback);
  });
});
