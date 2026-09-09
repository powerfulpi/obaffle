import type { ChatMessage } from "./types.js";

export class ConversationMemory {
  private readonly conversations = new Map<string, ChatMessage[]>();
  private readonly messageLimit: number;

  public constructor(maxMessages: number) {
    this.messageLimit = Math.max(2, maxMessages - (maxMessages % 2));
  }

  public get(key: string): ChatMessage[] {
    return [...(this.conversations.get(key) ?? [])];
  }

  public addExchange(key: string, userContent: string, assistantContent: string): void {
    const messages = this.conversations.get(key) ?? [];
    messages.push(
      { role: "user", content: userContent },
      { role: "assistant", content: assistantContent },
    );
    if (messages.length > this.messageLimit) {
      messages.splice(0, messages.length - this.messageLimit);
    }
    this.conversations.set(key, messages);
  }

  public clearConversation(key: string): boolean {
    return this.conversations.delete(key);
  }

  public clearGuild(guildId: string): number {
    let cleared = 0;
    for (const key of this.conversations.keys()) {
      if (key.startsWith(`${guildId}:`)) {
        this.conversations.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }

  public clearAll(): void {
    this.conversations.clear();
  }
}
