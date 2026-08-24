import type { ChatMessage, ConversationTurn } from "./types.js";

interface StoredConversation {
  expiresAt: number;
  turns: ConversationTurn[];
}

export interface ConversationStoreOptions {
  enabled?: boolean;
  maxChars?: number;
  maxContextChars?: number;
  maxTurns?: number;
  now?: () => number;
  ttlMs: number;
}

export class ConversationStore {
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly now: () => number;
  private readonly maxChars: number;
  private readonly maxTurns: number;
  private readonly isEnabled: boolean;

  public constructor(private readonly options: ConversationStoreOptions) {
    this.now = options.now ?? Date.now;
    this.maxChars = options.maxChars ?? options.maxContextChars ?? 12_000;
    this.maxTurns = options.maxTurns ?? 50;
    this.isEnabled = options.enabled !== false && this.maxChars > 0 && this.maxTurns > 0;
  }

  public appendTurn(key: string, user: string, assistant: string): void {
    if (!this.isEnabled) {
      return;
    }

    const existing = this.getActive(key) ?? { expiresAt: 0, turns: [] };
    existing.turns.push({ assistant, user });
    existing.expiresAt = this.now() + this.options.ttlMs;

    while (existing.turns.length > this.maxTurns) {
      existing.turns.shift();
    }

    while (
      existing.turns.length > 1 &&
      countTurnCharacters(existing.turns) > this.maxChars
    ) {
      existing.turns.shift();
    }

    if (existing.turns.length === 1) {
      existing.turns[0] = fitTurn(
        existing.turns[0]!,
        this.maxChars,
      );
    }

    this.conversations.set(key, existing);
  }

  public clear(key: string): boolean {
    return this.conversations.delete(key);
  }

  public getMessages(key: string): ChatMessage[] {
    if (!this.isEnabled) {
      return [];
    }

    const conversation = this.getActive(key);
    if (!conversation) {
      return [];
    }

    return conversation.turns.flatMap((turn) => [
      { content: turn.user, role: "user" as const },
      { content: turn.assistant, role: "assistant" as const },
    ]);
  }

  public size(): number {
    this.sweep();
    return this.conversations.size;
  }

  public sweep(): number {
    const now = this.now();
    let removed = 0;

    for (const [key, conversation] of this.conversations) {
      if (conversation.expiresAt <= now) {
        this.conversations.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  private getActive(key: string): StoredConversation | undefined {
    const conversation = this.conversations.get(key);
    if (!conversation) {
      return undefined;
    }

    if (conversation.expiresAt <= this.now()) {
      this.conversations.delete(key);
      return undefined;
    }

    return conversation;
  }
}

function countTurnCharacters(turns: readonly ConversationTurn[]): number {
  return turns.reduce(
    (total, turn) => total + turn.user.length + turn.assistant.length,
    0,
  );
}

function fitTurn(turn: ConversationTurn, maxCharacters: number): ConversationTurn {
  if (turn.user.length + turn.assistant.length <= maxCharacters) {
    return turn;
  }

  const userBudget = Math.min(turn.user.length, Math.floor(maxCharacters / 2));
  const assistantBudget = Math.max(0, maxCharacters - userBudget);
  return {
    assistant: turn.assistant.slice(0, assistantBudget),
    user: turn.user.slice(0, userBudget),
  };
}
