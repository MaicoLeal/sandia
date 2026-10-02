import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";
const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event("app-update"));
  },
});
window.addEventListener("app-update-apply", () => {
  void updateSW(true).catch(() =>
    window.dispatchEvent(new Event("app-update-error")),
  );
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
