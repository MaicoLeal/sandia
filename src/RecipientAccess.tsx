import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Field, Modal } from "./components";
import { kg } from "./domain";
import { listRecipientAccounts, setRecipientAccess } from "./services/supabase";
import type { Pallet, RecipientAccount } from "./types";

export function RecipientAccess({
  pallets,
  onClose,
}: {
  pallets: Pallet[];
  onClose: () => void;
}) {
  const [accounts, setAccounts] = useState<RecipientAccount[]>([]);
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    void listRecipientAccounts()
      .then((rows) => {
        if (active) {
          setAccounts(rows);
          setAvailable(true);
          setBusy(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : "No se pudo consultar los accesos.",
          );
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const choose = (id: string) => {
    const account = accounts.find((a) => a.user_id === id);
    setUserId(id);
    setEmail(account?.email ?? "");
    setName(account?.name ?? "");
    setSelected(
      (account?.pallet_ids ?? []).filter((id) =>
        pallets.some((p) => p.id === id && p.status !== "Cancelado"),
      ),
    );
    setMessage("");
  };
  return (
    <Modal title="Acceso de destinatarios" onClose={onClose}>
      <p className="hint">
        El destinatario consulta solo los pallets seleccionados: códigos,
        fechas, peso, destino y estado.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          void setRecipientAccess(userId, email, name, selected)
            .then(async () => {
              const rows = await listRecipientAccounts();
              setAccounts(rows);
              setMessage(
                "Acceso actualizado. El destinatario ya puede iniciar sesión.",
              );
            })
            .catch((e: unknown) =>
              setError(
                e instanceof Error
                  ? e.message
                  : "No se pudo guardar el acceso.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Destinatario">
          <select
            value={accounts.some((a) => a.user_id === userId) ? userId : ""}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Nuevo destinatario</option>
            {accounts.map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.name} · {a.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nombre">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Correo electrónico">
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="ID del usuario de Supabase">
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value.trim())}
            required
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          />
        </Field>
        <p className="hint">
          La cuenta debe existir en Authentication → Users. Copie su ID; la
          contraseña se define allí.
        </p>
        <fieldset className="recipient-options">
          <legend>Pallets autorizados · {selected.length} seleccionados</legend>
          {pallets
            .filter((p) => p.status !== "Cancelado")
            .map((p) => (
              <label className="recipient-option" key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, p.id]
                        : ids.filter((id) => id !== p.id),
                    )
                  }
                />
                <span>
                  <strong>{p.code}</strong>
                  <small>
                    {kg(p.net_kg)} kg · {p.destination}
                  </small>
                </span>
              </label>
            ))}
        </fieldset>
        <p className="hint">
          Guardar reemplaza la selección anterior. Sin pallets seleccionados, la
          cuenta queda sin cargas autorizadas.
        </p>
        <button
          className="button primary full"
          type="submit"
          disabled={busy || !available}
        >
          <CheckCircle2 size={18} />
          {busy ? "Guardando…" : "Guardar acceso"}
        </button>
      </form>
    </Modal>
  );
}
