import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppUpdateController } from "./app-update";

class Worker extends EventTarget {
  state: ServiceWorkerState = "installing";
  move(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
class Registration extends EventTarget {
  waiting: Worker | null = null;
  installing: Worker | null = null;
  update = vi.fn(async () => this);
  native() {
    return this as unknown as ServiceWorkerRegistration;
  }
}
const create = (
  options: Parameters<typeof createAppUpdateController>[0] = {},
) =>
  createAppUpdateController({
    supported: () => true,
    online: () => true,
    ...options,
  });
const settle = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

describe("actualizaciones de la aplicación", () => {
  it("conserva una actualización detectada antes de suscribirse", () => {
    const controller = create();
    const initial = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(initial);
    controller.markAvailable();
    const detected = controller.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    expect(detected.available).toBe(true);
    controller.markAvailable();
    expect(controller.getSnapshot()).toBe(detected);
    expect(listener).not.toHaveBeenCalled();
    controller.failRegistration();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    controller.markAvailable();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("detecta el worker waiting desde el registro sin depender de Workbox", () => {
    const controller = create();
    const registration = new Registration();
    registration.waiting = new Worker();
    controller.setRegistration(registration.native());
    expect(controller.getSnapshot().available).toBe(true);
  });

  it("busca una versión y aplica solamente por llamada explícita", async () => {
    const controller = create();
    const registration = new Registration();
    const apply = vi.fn(async () => {});
    controller.setApplyUpdate(apply);
    controller.setRegistration(registration.native());
    await controller.check();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      checked: true,
      checking: false,
      available: false,
      error: "",
    });
    await controller.apply();
    expect(apply).not.toHaveBeenCalled();
    controller.markAvailable();
    expect(apply).not.toHaveBeenCalled();
    await controller.apply();
    expect(apply).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("espera que finalice la instalación antes de completar la comprobación", async () => {
    vi.useFakeTimers();
    const controller = create();
    const registration = new Registration();
    const installing = new Worker();
    registration.update.mockImplementation(async () => {
      registration.installing = installing;
      registration.dispatchEvent(new Event("updatefound"));
      return registration;
    });
    controller.setRegistration(registration.native());
    const checking = controller.check();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      checking: true,
      checked: false,
    });
    registration.waiting = installing;
    registration.installing = null;
    installing.move("installed");
    await vi.advanceTimersByTimeAsync(0);
    await checking;
    expect(controller.getSnapshot()).toMatchObject({
      available: true,
      checking: false,
      checked: true,
    });
  });

  it("deduplica comprobaciones simultáneas y conserva el pedido manual", async () => {
    const controller = create();
    const registration = new Registration();
    let finish!: (value: Registration) => void;
    registration.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    controller.setRegistration(registration.native());
    const automatic = controller.check(false);
    const manual = controller.check();
    expect(automatic).toBe(manual);
    await settle();
    finish(registration);
    await manual;
    expect(registration.update).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().checked).toBe(true);
  });

  it("una comprobación automática no afirma que el usuario comprobó la versión", async () => {
    const controller = create();
    const registration = new Registration();
    controller.setRegistration(registration.native());
    await controller.check(false);
    expect(controller.getSnapshot()).toMatchObject({
      checking: false,
      checked: false,
      error: "",
    });
  });

  it("espera el registro tardío sin perder un worker ya listo", async () => {
    vi.useFakeTimers();
    const controller = create();
    const checking = controller.check();
    await settle();
    const registration = new Registration();
    registration.waiting = new Worker();
    controller.setRegistration(registration.native());
    await checking;
    expect(controller.getSnapshot()).toMatchObject({
      available: true,
      checked: true,
      error: "",
    });
  });

  it.each([
    [{ supported: () => false }, /HTTPS/],
    [{ online: () => false }, /internet/],
  ])(
    "presenta un error cuando no puede comprobar actualizaciones",
    async (options, message) => {
      const controller = create(options);
      await controller.check();
      expect(controller.getSnapshot()).toMatchObject({
        checking: false,
        checked: false,
      });
      expect(controller.getSnapshot().error).toMatch(message);
    },
  );

  it("permite reintentar un fallo de conexión sin afirmar versión actual", async () => {
    const controller = create();
    const registration = new Registration();
    registration.update.mockRejectedValueOnce(new Error("Fallo de red"));
    controller.setRegistration(registration.native());
    await controller.check();
    expect(controller.getSnapshot()).toMatchObject({
      checked: false,
      error: "Fallo de red",
    });
    await controller.check();
    expect(controller.getSnapshot()).toMatchObject({
      checked: true,
      error: "",
    });
  });

  it("limita la espera de un registro que nunca llega", async () => {
    vi.useFakeTimers();
    const controller = create({ timeoutMs: 100 });
    const checking = controller.check();
    await vi.advanceTimersByTimeAsync(101);
    await checking;
    expect(controller.getSnapshot()).toMatchObject({
      checking: false,
      checked: false,
    });
    expect(controller.getSnapshot().error).toMatch(/tardó demasiado/);
  });

  it("no presenta una instalación fallida como versión comprobada", async () => {
    const controller = create();
    const registration = new Registration();
    registration.installing = new Worker();
    registration.installing.state = "redundant";
    controller.setRegistration(registration.native());
    await controller.check();
    expect(controller.getSnapshot()).toMatchObject({
      checked: false,
      checking: false,
    });
    expect(controller.getSnapshot().error).toMatch(/descargar/);
  });

  it("conserva el aviso para reintentar una aplicación fallida", async () => {
    const controller = create();
    controller.setApplyUpdate(vi.fn().mockRejectedValue(new Error("Fallo")));
    controller.markAvailable();
    await expect(controller.apply()).rejects.toThrow("Fallo");
    expect(controller.getSnapshot()).toMatchObject({ available: true });
    expect(controller.getSnapshot().error).toMatch(/Guarde su trabajo/);
  });
});
