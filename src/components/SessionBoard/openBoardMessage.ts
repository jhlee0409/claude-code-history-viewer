import { useAppStore } from "../../store/useAppStore";
import type { BoardSessionData } from "../../types/board.types";

/**
 * Open a lane's message in the conversation: one navigation (plan §4.2).
 *
 * The lane already holds its session's whole message list, so a session
 * other than the open one opens from that cache instead of being fetched.
 * Passing it through `navigate` - rather than writing the session into the
 * store first - lets the transaction snapshot the board, with the session it
 * had, as the place Back returns to.
 */
export function openBoardMessage(
  data: BoardSessionData,
  messageId: string,
): Promise<boolean> {
  const { selectedSession, messages, navigate } = useAppStore.getState();
  const isOpen =
    selectedSession?.session_id === data.session.session_id &&
    messages.length > 0;
  return navigate(
    isOpen
      ? { view: "conversation", messageId }
      : {
          view: "conversation",
          session: data.session,
          sessionMessages: data.messages,
          messageId,
        },
  );
}
