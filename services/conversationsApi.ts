import { authenticatedFetch } from './loginApi';

export interface ConversationMessage {
  id: number;
  content: string;
  message_type: string;
  sender_id: number;
  sender_name: string;
  created_at: string;
  is_deleted: boolean;
}

export interface OtherParticipant {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface ConversationResponse {
  id: number;
  is_group: boolean;
  name: string | null;
  display_name: string;
  other_participant: OtherParticipant | null;
  created_by: number;
  latest_message: ConversationMessage | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationsListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: ConversationResponse[];
}

/**
 * Fetch conversations list
 * @param isGroup - Filter by group conversations (true) or DMs (false)
 * @param page - Page number for pagination
 * @returns List of conversations
 */
export const fetchConversations = async (
  isGroup: boolean = false,
  page: number = 1
): Promise<ConversationsListResponse> => {
  try {
    const response = await authenticatedFetch(
      `/chat/api/conversations/?is_group=${isGroup}&page=${page}`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Failed to fetch conversations:', errorData);
      throw new Error(errorData.detail || `Failed to fetch conversations: ${response.status}`);
    }

    const data: ConversationsListResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching conversations:', error);
    throw error;
  }
};

/**
 * Fetch a single conversation by ID
 * @param conversationId - The conversation ID
 * @returns Conversation details
 */
export const fetchConversationById = async (
  conversationId: number
): Promise<ConversationResponse> => {
  try {
    const response = await authenticatedFetch(`/chat/api/conversations/${conversationId}/`, {
      method: 'GET',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to fetch conversation: ${response.status}`);
    }

    const data: ConversationResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching conversation:', error);
    throw error;
  }
};

/**
 * Create a new conversation
 * @param isGroup - Whether it's a group conversation
 * @param name - Conversation name (required for groups)
 * @param participantIds - Array of user IDs to add as participants
 * @returns Created conversation
 */
export const createConversation = async (
  isGroup: boolean,
  participantIds: number[],
  name?: string
): Promise<ConversationResponse> => {
  try {
    const response = await authenticatedFetch('/chat/api/conversations/', {
      method: 'POST',
      body: JSON.stringify({
        is_group: isGroup,
        name: name || null,
        participant_ids: participantIds,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to create conversation: ${response.status}`);
    }

    const data: ConversationResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }
};

/**
 * Delete a conversation
 * @param conversationId - The conversation ID to delete
 */
export const deleteConversation = async (conversationId: number): Promise<void> => {
  try {
    const response = await authenticatedFetch(`/chat/api/conversations/${conversationId}/`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to delete conversation: ${response.status}`);
    }
  } catch (error) {
    console.error('Error deleting conversation:', error);
    throw error;
  }
};

export interface Participant {
  id: number;
  user: OtherParticipant;
  joined_at: string;
  is_admin: boolean;
}

/**
 * Fetch participants of a conversation
 * @param conversationId - The conversation ID
 * @returns List of participants
 */
export const fetchParticipants = async (conversationId: number): Promise<Participant[]> => {
  try {
    const response = await authenticatedFetch(
      `/chat/api/conversations/${conversationId}/participants/`,
      { method: 'GET' }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to fetch participants: ${response.status}`);
    }

    const data: Participant[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching participants:', error);
    throw error;
  }
};
