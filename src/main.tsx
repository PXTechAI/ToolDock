import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ColorPickerOverlay } from "./components/ColorPickerOverlay";
import { RegionSelectorOverlay } from "./components/RegionSelectorOverlay";
import "./styles.css";

const searchParams = new URLSearchParams(window.location.search);
const pickerMonitor = searchParams.get("pickerMonitor");
const regionSelectorMonitor = searchParams.get("regionSelectorMonitor");
if (pickerMonitor !== null || regionSelectorMonitor !== null) {
  document.documentElement.classList.add("color-picker-document");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {pickerMonitor !== null ? (
      <ColorPickerOverlay monitorId={Number.parseInt(pickerMonitor, 10)} />
    ) : regionSelectorMonitor !== null ? (
      <RegionSelectorOverlay monitorId={Number.parseInt(regionSelectorMonitor, 10)} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
