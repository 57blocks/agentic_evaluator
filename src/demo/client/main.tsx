/** Mounts the app, and nothing else. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { followSystemTheme } from "./app/theme";
import "./styles.css";

followSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
