import useApiService from "@hooks/useApiService";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import Image from "next/image";
import { useRouter } from "next/router";
import { NextPage } from "next/types";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { gameStatsAtom } from "src/state";
import styles from "../styles/index.module.css";
import mpStyles from "../styles/multiplayer.module.css";

const MultiplayerPhaserGame = lazy(
  () => import("../game/MultiplayerPhaserGame")
);

const MultiplayerPage: NextPage = () => {
  const router = useRouter();
  const apiService = useApiService();
  const [_gameStats, setGameStats] = useAtom(gameStatsAtom);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  // Clear multiplayer session data
  const clearMultiplayerSession = useCallback(() => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("isGuest");
    sessionStorage.removeItem("guestId");
  }, []);

  // Handle route changes and browser back button
  useEffect(() => {
    const handleRouteChange = (url: string) => {
      // Only clear session when navigating away from multiplayer
      if (!url.includes("/multiplayer")) {
        clearMultiplayerSession();
      }
    };

    // Handle browser back/forward buttons
    const handlePopState = () => {
      setIsLeaving(true);
      clearMultiplayerSession();
      // Force navigation to home page
      window.location.href = "/";
    };

    router.events.on("routeChangeStart", handleRouteChange);
    window.addEventListener("popstate", handlePopState);

    return () => {
      router.events.off("routeChangeStart", handleRouteChange);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [router.events, clearMultiplayerSession]);

  // Always fetch a fresh token on page load to avoid using expired cached tokens
  // We only preserve guestId for guest user continuity
  useEffect(() => {
    // Clear potentially expired token, we'll get a fresh one from joinMultiplayerQuery
    sessionStorage.removeItem("token");
    // Keep guestId for guest reconnection, but clear isGuest flag to force re-auth
    sessionStorage.removeItem("isGuest");
  }, []);

  // Validate session to get user info for authenticated users
  const sessionValidationQuery = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.validateSession();
    },
    enabled: !!apiService && !isLeaving,
    retry: false,
  });

  // Join multiplayer - this handles both authenticated and guest users
  const joinMultiplayerQuery = useQuery({
    queryKey: ["multiplayer"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      // Pass guest ID if we have one stored (for guest reconnection)
      const existingGuestId = sessionStorage.getItem("guestId");
      return apiService.joinMultiplayer(existingGuestId || undefined);
    },
    enabled: !!apiService && !token && !isLeaving,
    retry: false,
  });

  // Set gameStats for authenticated users when session is validated
  useEffect(() => {
    if (
      sessionValidationQuery.isSuccess &&
      sessionValidationQuery.data?.success
    ) {
      const userInfo = sessionValidationQuery.data.data;
      if (userInfo) {
        setGameStats((prev) => ({
          ...prev,
          user_id: userInfo.id,
          username: userInfo.username,
        }));
      }
    }
  }, [
    sessionValidationQuery.isSuccess,
    sessionValidationQuery.data,
    setGameStats,
  ]);

  // Handle join multiplayer result
  useEffect(() => {
    if (isLeaving) return;

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
    isLeaving,
  ]);

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

  const handleLeave = useCallback(() => {
    setIsLeaving(true);
    clearMultiplayerSession();
    window.location.href = "/";
  }, [clearMultiplayerSession]);

  if (error) {
    return (
      <div className={styles.container}>
        <p className={mpStyles.errorText}>{error}</p>
        <button
          onClick={() => {
            setError(null);
            sessionStorage.removeItem("token");
            setToken(null);
            setIsReady(false);
            joinMultiplayerQuery.refetch();
          }}
          className={mpStyles.retryButton}
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
          loading="eager"
        />
        <p className={mpStyles.loadingText}>
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
            loading="eager"
          />
        </div>
      }
    >
      <MultiplayerPhaserGame
        token={token}
        isGuest={isGuest}
        onLeave={handleLeave}
        guestId={guestId}
        onLoginSuccess={handleLoginSuccess}
      />
    </Suspense>
  );
};

export default MultiplayerPage;
