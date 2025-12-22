import { logger } from "@utils/logger";
import {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

interface ISocketContext {
  ws: WebSocket | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: (token: string) => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  reconnectWithToken: (token: string) => Promise<void>;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;
if (!WS_URL) {
  throw new Error("NEXT_PUBLIC_WS_URL environment variable is not set");
}

const SocketContext = createContext<ISocketContext>({} as ISocketContext);

export function SocketProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement | null {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const disconnect = useCallback(() => {
    if (ws) {
      ws.close();
      setWs(null);
      setIsConnected(false);
      setIsConnecting(false);
      tokenRef.current = null;
    }
  }, [ws]);

  const connect = useCallback(
    async (token: string) => {
      if (isConnecting || isConnected) {
        logger.warn("Already connecting or connected");
        return;
      }

      setIsConnecting(true);
      setError(null);
      tokenRef.current = token;

      try {
        const websocket = new WebSocket(`${WS_URL}?token=${token}`);
        websocket.binaryType = "arraybuffer";

        websocket.onopen = () => {
          logger.info("Connected to multiplayer game server");
          setIsConnected(true);
          setIsConnecting(false);
          setError(null);
        };

        websocket.onclose = (event) => {
          logger.info(
            "Disconnected from multiplayer server",
            event.code,
            event.reason
          );
          setIsConnected(false);
          setIsConnecting(false);
          setWs(null);
        };

        websocket.onerror = (event) => {
          logger.error("WebSocket error:", event);
          setError("Failed to connect to multiplayer server");
          setIsConnecting(false);
          setIsConnected(false);
        };

        setWs(websocket);
      } catch (err) {
        logger.error("Connection error:", err);
        setError(
          err instanceof Error ? err.message : "Unknown connection error"
        );
        setIsConnecting(false);
      }
    },
    [isConnecting, isConnected]
  );

  const reconnect = useCallback(async () => {
    if (!tokenRef.current) {
      setError("No token available for reconnection");
      return;
    }

    disconnect();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await connect(tokenRef.current);
  }, [connect, disconnect]);

  const reconnectWithToken = useCallback(
    async (newToken: string) => {
      // Close existing connection if any
      if (ws) {
        ws.close();
        setWs(null);
      }

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Reset state and connect with new token
      setIsConnected(false);
      setIsConnecting(true);
      setError(null);
      tokenRef.current = newToken;

      try {
        const websocket = new WebSocket(`${WS_URL}?token=${newToken}`);
        websocket.binaryType = "arraybuffer";

        websocket.onopen = () => {
          logger.info("Reconnected to multiplayer game server");
          setIsConnected(true);
          setIsConnecting(false);
          setError(null);
        };

        websocket.onclose = (event) => {
          logger.info(
            "Disconnected from multiplayer server",
            event.code,
            event.reason
          );
          setIsConnected(false);
          setIsConnecting(false);
          setWs(null);
        };

        websocket.onerror = (event) => {
          logger.error("WebSocket error:", event);
          setError("Failed to connect to multiplayer server");
          setIsConnecting(false);
          setIsConnected(false);
        };

        setWs(websocket);
      } catch (err) {
        logger.error("Reconnection error:", err);
        setError(
          err instanceof Error ? err.message : "Unknown connection error"
        );
        setIsConnecting(false);
      }
    },
    [ws]
  );

  return (
    <SocketContext.Provider
      value={{
        ws,
        isConnected,
        isConnecting,
        error,
        connect,
        disconnect,
        reconnect,
        reconnectWithToken,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

export default SocketContext;
