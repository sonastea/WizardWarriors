import useApiService from "@hooks/useApiService";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import Image from "next/image";
import { NextPage } from "next/types";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { gameStatsAtom } from "src/state";
import styles from "../styles/index.module.css";

const MultiplayerPhaserGame = lazy(
  () => import("../game/MultiplayerPhaserGame")
);

const MultiplayerPage: NextPage = () => {
  const apiService = useApiService();
  const [_gameStats, setGameStats] = useAtom(gameStatsAtom);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = sessionStorage.getItem("token");
    const storedIsGuest = sessionStorage.getItem("isGuest") === "true";
    const storedGuestId = sessionStorage.getItem("guestId");

    if (storedToken) {
      setToken(storedToken);
      setIsGuest(storedIsGuest);
      if (storedGuestId) setGuestId(storedGuestId);
      setIsReady(true);
    }
  }, []);

  // Join multiplayer - this handles both authenticated and guest users
  const joinMultiplayerQuery = useQuery({
    queryKey: ["multiplayer"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      // Pass guest ID if we have one stored (for guest reconnection)
      const existingGuestId = sessionStorage.getItem("guestId");
      return apiService.joinMultiplayer(existingGuestId || undefined);
    },
    enabled: !!apiService && !token,
    retry: false,
  });

  // Handle join multiplayer result
  useEffect(() => {
    if (joinMultiplayerQuery.isSuccess && joinMultiplayerQuery.data?.success) {
      const data = joinMultiplayerQuery.data.data;
      if (data) {
        sessionStorage.setItem("token", data.token);
        sessionStorage.setItem("isGuest", data.isGuest.toString());

        if (data.isGuest && data.guestId) {
          sessionStorage.setItem("guestId", data.guestId);
          setGuestId(data.guestId);
          setGameStats((prev) => ({
            ...prev,
            user_id: -1,
            username: data.guestId || "Guest",
          }));
        }

        setToken(data.token);
        setIsGuest(data.isGuest);
        setIsReady(true);
      }
    } else if (
      joinMultiplayerQuery.isError ||
      (joinMultiplayerQuery.isSuccess && !joinMultiplayerQuery.data?.success)
    ) {
      setError("Failed to connect to multiplayer. Please try again.");
    }
  }, [
    joinMultiplayerQuery.isSuccess,
    joinMultiplayerQuery.isError,
    joinMultiplayerQuery.data,
    setGameStats,
  ]);

  // Callback when guest logs in via modal
  const handleLoginSuccess = useCallback(
    async (
      userInfo: { id: number; username: string },
      reconnectWithToken: (newToken: string) => Promise<void>
    ) => {
      setGameStats((prev) => ({
        ...prev,
        user_id: userInfo.id,
        username: userInfo.username,
      }));

      // Clear guest data
      sessionStorage.removeItem("guestId");
      sessionStorage.removeItem("isGuest");
      sessionStorage.removeItem("token");

      // Get new authenticated token and reconnect
      if (apiService) {
        const result = await apiService.joinMultiplayer();
        if (result.success && result.data) {
          sessionStorage.setItem("token", result.data.token);
          sessionStorage.setItem("isGuest", "false");
          setToken(result.data.token);
          setIsGuest(false);
          setGuestId(null);

          // Reconnect WebSocket with new authenticated token
          await reconnectWithToken(result.data.token);
        }
      }
    },
    [apiService, setGameStats]
  );

  if (error) {
    return (
      <div className={styles.container}>
        <p
          style={{ color: "#ff6b6b", fontSize: "1.2rem", textAlign: "center" }}
        >
          {error}
        </p>
        <button
          onClick={() => {
            setError(null);
            sessionStorage.removeItem("token");
            setToken(null);
            setIsReady(false);
            joinMultiplayerQuery.refetch();
          }}
          style={{
            marginTop: "1rem",
            padding: "10px 20px",
            backgroundColor: "#4a9eff",
            border: "none",
            borderRadius: "4px",
            color: "white",
            cursor: "pointer",
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!isReady || !token) {
    return (
      <div className={styles.container}>
        <Image
          src="/spinning-circles.svg"
          alt="Loading..."
          width={64}
          height={64}
        />
        <p style={{ color: "white", marginTop: "1rem" }}>
          {joinMultiplayerQuery.isFetching
            ? "Connecting to multiplayer..."
            : "Loading..."}
        </p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className={styles.container}>
          <Image
            src="/spinning-circles.svg"
            alt="Loading game..."
            width={64}
            height={64}
          />
        </div>
      }
    >
      <MultiplayerPhaserGame
        token={token}
        isGuest={isGuest}
        guestId={guestId}
        onLoginSuccess={handleLoginSuccess}
      />
    </Suspense>
  );
};

export default MultiplayerPage;
