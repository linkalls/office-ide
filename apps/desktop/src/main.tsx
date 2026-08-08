import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-jp";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Office IDE root element was not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
