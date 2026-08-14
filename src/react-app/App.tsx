import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import HomePage from "./HomePage";
import QuizPage from "./QuizPage";

function isHorizontalScroller(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest(".chat-md pre, .source-preview-body, .quiz-info-preview"))
  );
}

function isTextField(el: Element | null) {
  return (
    el instanceof HTMLElement &&
    (el.matches("input, textarea, select") || el.isContentEditable)
  );
}

function useLockHorizontalPageScroll() {
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    let startX = 0;
    let startY = 0;

    function snapX() {
      if (mq.matches && window.scrollX !== 0) {
        window.scrollTo(0, window.scrollY);
      }
    }

    function onTouchStart(event: TouchEvent) {
      if (!mq.matches || event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }

    function onTouchMove(event: TouchEvent) {
      if (!mq.matches || event.touches.length !== 1) return;
      if (!isTextField(document.activeElement)) return;
      if (isHorizontalScroller(event.target)) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        event.preventDefault();
      }
    }

    window.addEventListener("scroll", snapX, { passive: true });
    window.visualViewport?.addEventListener("scroll", snapX);
    window.visualViewport?.addEventListener("resize", snapX);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("scroll", snapX);
      window.visualViewport?.removeEventListener("scroll", snapX);
      window.visualViewport?.removeEventListener("resize", snapX);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
}

export default function App() {
  useLockHorizontalPageScroll();
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/quiz/:quizId" element={<QuizPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
