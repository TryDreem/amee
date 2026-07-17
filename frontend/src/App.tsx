import { BrowserRouter, Route, Routes } from "react-router-dom";

import Home from "./pages/Home";
import Editor from "./pages/Editor";

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects/:id" element={<Editor />} />
      </Routes>
    </BrowserRouter>
  );
}
