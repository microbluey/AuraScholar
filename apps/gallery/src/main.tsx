import React from "react";
import ReactDOM from "react-dom/client";
import "@aurascholar/tokens/tokens.css";
import "@aurascholar/ui/styles.css";
import { Gallery } from "./Gallery";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>,
);
