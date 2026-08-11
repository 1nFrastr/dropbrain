import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import HomePage from "./HomePage";
import QuizPage from "./QuizPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/quiz/:quizId" element={<QuizPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
