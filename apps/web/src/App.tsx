import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Gallery } from "./pages/Gallery";
import { GamePage } from "./pages/GamePage";

export function App() {
  return (
    <Suspense fallback={<div className="boot">Loading&hellip;</div>}>
      <Routes>
        <Route path="/" element={<Gallery />} />
        <Route path="/games/:id" element={<GamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
