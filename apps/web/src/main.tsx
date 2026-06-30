import React from "react";
import ReactDOM from "react-dom/client";
import { TriforgeApp } from "./TriforgeApp.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TriforgeApp />
  </React.StrictMode>
);
