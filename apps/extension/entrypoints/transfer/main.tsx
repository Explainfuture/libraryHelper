import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./style.css";

const rootElement = document.querySelector("#root");
if (rootElement === null) {
  throw new Error("BookBridge transfer root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
