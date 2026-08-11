import {
  streamChatAboutQuestion,
  type ChatTurn,
} from "./api";
import ChatSidebar from "./ChatSidebar";
import {
  chatSuggestions,
  type AppLanguage,
} from "./i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  quizId: string;
  questionId: string;
  questionStem: string;
  choice?: number;
  language: AppLanguage;
  messages: ChatTurn[];
  onMessagesChange: (messages: ChatTurn[]) => void;
};

export default function QuizChatSidebar({
  open,
  onClose,
  quizId,
  questionId,
  questionStem,
  choice,
  language,
  messages,
  onMessagesChange,
}: Props) {
  return (
    <ChatSidebar
      open={open}
      onClose={onClose}
      kicker="Dig deeper"
      title="Ask about this question"
      context={questionStem}
      emptyPrompt="Curious about a detail? Ask anything about this item."
      suggestions={chatSuggestions(language)}
      ariaLabel="Question chat"
      threadKey={questionId}
      messages={messages}
      onMessagesChange={onMessagesChange}
      stream={(next, onDelta, signal) =>
        streamChatAboutQuestion(
          quizId,
          questionId,
          next,
          language,
          choice,
          onDelta,
          signal,
        )
      }
    />
  );
}
