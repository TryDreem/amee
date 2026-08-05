import { BrowserRouter, Route, Routes } from "react-router-dom";

import Home from "./pages/Home";
import Editor from "./pages/Editor";
import { ExportProvider } from "./contexts/ExportContext";

export default function App(): JSX.Element {
  return (
    <ExportProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects/:id" element={<Editor />} />
        </Routes>
      </BrowserRouter>
    </ExportProvider>
  );
}
