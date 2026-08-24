export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
  type: "function";
}

export type ImageDetail = "auto" | "low" | "high";

export interface ChatTextPart {
  text: string;
  type: "text";
}

export interface ChatImagePart {
  image_url: {
    detail?: ImageDetail;
    url: string;
  };
  type: "image_url";
}

export type ChatContentPart = ChatTextPart | ChatImagePart;

export interface ChatMessage {
  content: string | ChatContentPart[] | null;
  name?: string;
  role: ChatRole;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ConversationTurn {
  assistant: string;
  user: string;
}

