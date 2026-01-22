import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OverlayScrollbars } from "overlayscrollbars";
import "overlayscrollbars/overlayscrollbars.css";
import "./index.css";
import "./scrollbar.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./i18n";
import { ThemeProvider } from "./contexts/theme/ThemeProvider.tsx";
import { ModalProvider } from "./contexts/modal/ModalProvider.tsx";

// Apply OverlayScrollbars globally to body
OverlayScrollbars(document.body, {
  scrollbars: {
    theme: "os-theme-custom",
    autoHide: "leave",
    autoHideDelay: 400,
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ModalProvider>
          <App />
        </ModalProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
