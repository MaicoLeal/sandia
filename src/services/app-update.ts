export interface AppUpdateSnapshot {
  readonly available: boolean;
  readonly checking: boolean;
  readonly error: string;
  readonly checked: boolean;
}

type ApplyUpdate = (reloadPage?: boolean) => Promise<void>;
type RegisterWorker = (options: {
  onNeedRefresh: () => void;
  onRegisteredSW: (
    url: string,
    registration?: ServiceWorkerRegistration,
  ) => void;
  onRegisterError: (error: unknown) => void;
}) => ApplyUpdate;

const UPDATE_TIMEOUT_MS = 10_000;
const AUTOMATIC_INTERVAL_MS = 60_000;

function bounded<T>(promise: Promise<T>, duration: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error("La comprobación tardó demasiado. Intente nuevamente."),
        ),
      duration,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

// This store exists before React mounts, so an already waiting worker cannot
// lose its update notice. Updating it never touches operational storage.
export function createAppUpdateController(
  options: {
    supported?: () => boolean;
    online?: () => boolean;
    timeoutMs?: number;
  } = {},
) {
  const supported = options.supported ?? (() => "serviceWorker" in navigator);
  const online = options.online ?? (() => navigator.onLine);
  const timeoutMs = options.timeoutMs ?? UPDATE_TIMEOUT_MS;
  let snapshot: AppUpdateSnapshot = Object.freeze({
    available: false,
    checking: false,
    error: "",
    checked: false,
  });
  const listeners = new Set<() => void>();
  const registrationListeners = new Set<() => void>();
  let registration: ServiceWorkerRegistration | undefined;
  let registrationFailure = "";
  let applyUpdate: ApplyUpdate | undefined;
  let checking: Promise<void> | undefined;
  let manualRequested = false;

  const change = (fields: Partial<AppUpdateSnapshot>) => {
    const next = { ...snapshot, ...fields };
    if (
      Object.keys(next).every(
        (key) =>
          next[key as keyof AppUpdateSnapshot] ===
          snapshot[key as keyof AppUpdateSnapshot],
      )
    )
      return;
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const markAvailable = () => change({ available: true, error: "" });
  const setRegistration = (value?: ServiceWorkerRegistration) => {
    registration = value;
    if (value) registrationFailure = "";
    if (value?.waiting) markAvailable();
    registrationListeners.forEach((listener) => listener());
  };
  const failRegistration = () => {
    registrationFailure =
      "No se pudo registrar la actualización. Vuelva a abrir la aplicación con internet.";
    change({ error: registrationFailure, checked: false });
    registrationListeners.forEach((listener) => listener());
  };
  const waitForRegistration = () => {
    if (registration) return Promise.resolve(registration);
    return bounded(
      new Promise<ServiceWorkerRegistration>((resolve, reject) => {
        const ready = () => {
          if (registration) {
            registrationListeners.delete(ready);
            resolve(registration);
          } else if (registrationFailure) {
            registrationListeners.delete(ready);
            reject(new Error(registrationFailure));
          }
        };
        registrationListeners.add(ready);
        ready();
        setTimeout(() => registrationListeners.delete(ready), timeoutMs);
      }),
      timeoutMs,
    );
  };
  const check = (manual = true): Promise<void> => {
    manualRequested ||= manual;
    if (checking) return checking;
    change({ checking: true, checked: false, error: "" });
    checking = Promise.resolve()
      .then(async () => {
        if (!supported())
          throw new Error(
            "Las actualizaciones de la aplicación requieren el sitio publicado en HTTPS.",
          );
        if (!online())
          throw new Error(
            "Conecte el dispositivo a internet para comprobar la actualización.",
          );
        const workerRegistration = await waitForRegistration();
        let worker = workerRegistration.installing;
        const found = () => {
          worker = workerRegistration.installing;
        };
        workerRegistration.addEventListener("updatefound", found);
        let stopWatching = () => {};
        try {
          await bounded(
            (async () => {
              await workerRegistration.update();
              worker = workerRegistration.installing ?? worker;
              if (
                worker &&
                worker.state !== "activated" &&
                worker.state !== "installed"
              ) {
                const installing = worker;
                await new Promise<void>((resolve, reject) => {
                  const stateChanged = () => {
                    if (installing.state === "redundant")
                      reject(
                        new Error(
                          "No se pudo descargar la nueva versión. Intente nuevamente.",
                        ),
                      );
                    if (
                      installing.state === "installed" ||
                      installing.state === "activated"
                    )
                      setTimeout(resolve, 0);
                  };
                  stopWatching = () =>
                    installing.removeEventListener("statechange", stateChanged);
                  installing.addEventListener("statechange", stateChanged);
                  stateChanged();
                });
              } else if (worker?.state === "installed") {
                // Allow the browser to publish registration.waiting after the
                // installation event before reporting the result to the operator.
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
              }
              if (worker?.state === "redundant")
                throw new Error(
                  "No se pudo descargar la nueva versión. Intente nuevamente.",
                );
              if (workerRegistration.waiting) markAvailable();
            })(),
            timeoutMs,
          );
          change({ checking: false, checked: manualRequested, error: "" });
        } finally {
          stopWatching();
          workerRegistration.removeEventListener("updatefound", found);
        }
      })
      .catch((error: unknown) => {
        change({
          checking: false,
          checked: false,
          error:
            error instanceof Error
              ? error.message
              : "No se pudo comprobar la actualización.",
        });
      })
      .finally(() => {
        checking = undefined;
        manualRequested = false;
      });
    return checking;
  };
  const apply = async () => {
    if (!snapshot.available || !applyUpdate) return;
    try {
      change({ error: "" });
      await applyUpdate(true);
    } catch (error) {
      change({
        error:
          "No se pudo actualizar. Guarde su trabajo y vuelva a abrir la aplicación.",
      });
      throw error;
    }
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setRegistration,
    failRegistration,
    markAvailable,
    setApplyUpdate: (callback: ApplyUpdate) => {
      applyUpdate = callback;
    },
    check,
    apply,
  };
}

const controller = createAppUpdateController();
export const subscribeAppUpdate = controller.subscribe;
export const getAppUpdateSnapshot = controller.getSnapshot;
export const checkAppUpdate = () => controller.check();
export const applyAppUpdate = controller.apply;

export function initializeAppUpdates(
  registerWorker: RegisterWorker,
  options: { automatic?: boolean } = {},
) {
  controller.setApplyUpdate(
    registerWorker({
      onNeedRefresh: controller.markAvailable,
      onRegisteredSW: (_url, registration) =>
        controller.setRegistration(registration),
      onRegisterError: controller.failRegistration,
    }),
  );
  let lastAutomaticCheck = 0;
  const checkAutomatically = () => {
    if (options.automatic === false) return;
    if (!navigator.onLine || document.visibilityState === "hidden") return;
    if (Date.now() - lastAutomaticCheck < AUTOMATIC_INTERVAL_MS) return;
    lastAutomaticCheck = Date.now();
    void controller.check(false);
  };
  window.addEventListener("focus", checkAutomatically);
  window.addEventListener("online", checkAutomatically);
  document.addEventListener("visibilitychange", checkAutomatically);
  return () => {
    window.removeEventListener("focus", checkAutomatically);
    window.removeEventListener("online", checkAutomatically);
    document.removeEventListener("visibilitychange", checkAutomatically);
  };
}
