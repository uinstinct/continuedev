import { EventEmitter } from "events";

export interface BackgroundSignal {
  toolCallId?: string;
  command?: string;
}

export class BackgroundSignalManager extends EventEmitter {
  private pendingBackgroundSignal: BackgroundSignal | null = null;
  private currentToolCallId: string | null = null;

  setCurrentToolCall(toolCallId: string | null): void {
    this.currentToolCallId = toolCallId;
  }

  getCurrentToolCallId(): string | null {
    return this.currentToolCallId;
  }

  signalBackground(): void {
    if (this.currentToolCallId) {
      this.pendingBackgroundSignal = { toolCallId: this.currentToolCallId };
      this.emit("backgroundRequested", this.pendingBackgroundSignal);
    }
  }

  consumeSignal(): BackgroundSignal | null {
    const signal = this.pendingBackgroundSignal;
    this.pendingBackgroundSignal = null;
    return signal;
  }

  hasPendingSignal(): boolean {
    return this.pendingBackgroundSignal !== null;
  }

  clearSignal(): void {
    this.pendingBackgroundSignal = null;
  }
}

export const backgroundSignalManager = new BackgroundSignalManager();
