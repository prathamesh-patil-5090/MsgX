import { ConversationResponse } from './conversationsApi';
import { getAccessToken } from './loginApi';

export interface InitialConversationsEvent {
  type: 'initial_conversations';
  conversations: ConversationResponse[];
}

export interface ConversationUpdatePayload {
  id: number;
  is_group?: boolean;
  name?: string | null;
  latest_message?: {
    content: string;
    message_type: string;
    sender_id: number;
    sender_name: string;
    created_at: string;
    is_deleted: boolean;
  };
}

export interface ConversationUpdateEvent {
  type: 'conversation_update';
  action: 'new_message' | 'new_conversation' | 'deleted';
  conversation: ConversationUpdatePayload;
}

export type ConversationsWSEvent = InitialConversationsEvent | ConversationUpdateEvent;

export type ConversationsEventHandler = (event: ConversationsWSEvent) => void;

/**
 * Singleton WebSocket service for the conversations list.
 * Connects to `ws/conversations/`, receives the full list on connect,
 * and real-time updates afterwards.
 */
class ConversationsWebSocketService {
  private ws: WebSocket | null = null;
  private eventHandlers: Set<ConversationsEventHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isIntentionallyClosed = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[ConversationsWS] Already connected');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      console.log('[ConversationsWS] Connection already in progress');
      return;
    }

    this.isIntentionallyClosed = false;

    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('No access token available');
    }

    const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';
    const wsBaseUrl = apiBaseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    const wsUrl = `${wsBaseUrl}/ws/conversations/?token=${accessToken}`;

    console.log('[ConversationsWS] Connecting…');

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[ConversationsWS] Connected');
      this.reconnectAttempts = 0;
      this._startPing();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;
        this.eventHandlers.forEach((handler) => handler(data as ConversationsWSEvent));
      } catch (err) {
        console.error('[ConversationsWS] Failed to parse message:', err);
      }
    };

    this.ws.onerror = (error: Event) => {
      console.error('[ConversationsWS] Error:', error);
    };

    this.ws.onclose = () => {
      console.log('[ConversationsWS] Closed');
      this._stopPing();

      if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        console.log(
          `[ConversationsWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
        );
        this.reconnectTimeout = setTimeout(() => this.connect(), delay);
      }
    };
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this._stopPing();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
  }

  /** Ask the server to re-send the full conversation list. */
  refresh(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'refresh' }));
    }
  }

  /** Subscribe to WebSocket events. Returns an unsubscribe function. */
  onEvent(handler: ConversationsEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private _startPing(): void {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30_000);
  }

  private _stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

/** Shared singleton – both DM and Group screens use the same connection. */
export const conversationsWebSocketService = new ConversationsWebSocketService();
