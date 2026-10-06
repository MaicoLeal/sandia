import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { initializeAppUpdates } from "./services/app-update";
import "./styles.css";
initializeAppUpdates(registerSW, { automatic: import.meta.env.PROD });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
