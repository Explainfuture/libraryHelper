import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./style.css";

const root = document.querySelector<HTMLElement>("#root");
if (root === null) {
  throw new Error("BookBridge transfer root element is missing");
}

const transferId = new URL(window.location.href).searchParams.get("transferId");
createRoot(root).render(
  <StrictMode>
    <App transferId={transferId} />
  </StrictMode>,
);
