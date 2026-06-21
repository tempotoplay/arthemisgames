import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

// Vite's BASE_URL is "/arthemisgames/" in production and "/" in dev. React
// Router wants a basename without the trailing slash.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

// SPA fallback: if redirected from a 404, navigate to the intended route.
const redirectRoute = window.sessionStorage.getItem("redirectRoute");
if (redirectRoute) {
  window.sessionStorage.removeItem("redirectRoute");
  window.history.replaceState(null, "", basename + redirectRoute);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
