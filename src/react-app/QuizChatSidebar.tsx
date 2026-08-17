import {
  streamChatAboutQuestion,
  type ChatTurn,
} from "./api";
import ChatSidebar from "./ChatSidebar";
import {
  chatSuggestions,
  chatTruncatedHint,
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
  online?: boolean;
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
  online = true,
}: Props) {
  return (
    <ChatSidebar
      open={open}
      onClose={onClose}
      kicker="Dig deeper"
      title="Ask about this question"
      context={questionStem}
      emptyPrompt={
        online
          ? "Curious about a detail? Ask anything about this item."
          : "Chat needs a network connection. Your quiz progress still works offline."
      }
      suggestions={online ? chatSuggestions(language) : []}
      truncatedHint={chatTruncatedHint(language)}
      ariaLabel="Question chat"
      threadKey={questionId}
      messages={messages}
      onMessagesChange={onMessagesChange}
      stream={(next, onDelta, signal) => {
        if (!online) {
          return Promise.reject(
            new Error("Chat needs a network connection."),
          );
        }
        return streamChatAboutQuestion(
          quizId,
          questionId,
          next,
          language,
          choice,
          onDelta,
          signal,
        );
      }}
    />
  );
}
