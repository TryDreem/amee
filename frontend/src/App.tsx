import { BrowserRouter, Route, Routes } from "react-router-dom";

import Home from "./pages/Home";
import Editor from "./pages/Editor";
import { AuthProvider } from "./contexts/AuthContext";
import { ExportProvider } from "./contexts/ExportContext";
import { TranscribeProvider } from "./contexts/TranscribeContext";

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <ExportProvider>
        <TranscribeProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/projects/:id" element={<Editor />} />
            </Routes>
          </BrowserRouter>
        </TranscribeProvider>
      </ExportProvider>
    </AuthProvider>
  );
}
