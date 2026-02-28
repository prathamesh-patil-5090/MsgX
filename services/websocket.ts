import { getAccessToken } from './loginApi';

export interface WebSocketMessage {
  message: string;
  message_type: 'TEXT';
}

export interface WebSocketResponse {
  message: string;
  sender_id: number;
  sender_name?: string;
  temp_id: string;
}

export type MessageHandler = (data: WebSocketResponse) => void;
export type ErrorHandler = (error: Event) => void;
export type CloseHandler = () => void;
export type OpenHandler = () => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private conversationId: string | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private closeHandlers: Set<CloseHandler> = new Set();
  private openHandlers: Set<OpenHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isIntentionallyClosed = false;

  async connect(conversationId: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.conversationId === conversationId) {
        console.log('WebSocket already connected to this conversation');
        return;
      }
      this.disconnect();
    }

    this.conversationId = conversationId;
    this.isIntentionallyClosed = false;

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('No access token available');
      }

      const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const wsBaseUrl = apiBaseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      const wsUrl = `${wsBaseUrl}/ws/chat/${conversationId}/?token=${accessToken}`;

      console.log('Connecting to WebSocket:', wsUrl);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.openHandlers.forEach((handler) => handler());
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WebSocketResponse = JSON.parse(event.data);
          console.log('WebSocket message received:', data);
          this.messageHandlers.forEach((handler) => handler(data));
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.errorHandlers.forEach((handler) => handler(error));
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.closeHandlers.forEach((handler) => handler());

        if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

          this.reconnectTimeout = setTimeout(() => {
            if (this.conversationId) {
              this.connect(this.conversationId);
            }
          }, delay);
        }
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      throw error;
    }
  }

  sendMessage(message: string): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not connected');
      throw new Error('WebSocket is not connected');
    }

    const tempId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const payload = {
      message,
      message_type: 'TEXT' as const,
      temp_id: tempId,
    };

    console.log('Sending message:', payload);
    this.ws.send(JSON.stringify(payload));
    return tempId;
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.conversationId = null;
    this.reconnectAttempts = 0;
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onOpen(handler: OpenHandler): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getConnectionState(): number | null {
    return this.ws ? this.ws.readyState : null;
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
