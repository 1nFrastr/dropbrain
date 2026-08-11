import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Props = {
  children: string;
  /** Skip syntax highlighting while tokens are still arriving. */
  streaming?: boolean;
};

export default function ChatMarkdown({ children, streaming = false }: Props) {
  return (
    <div className={`chat-md${streaming ? " streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming ? [] : [rehypeHighlight]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
