import useApiService from "@hooks/useApiService";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import Image from "next/image";
import { useRouter } from "next/router";
import { NextPage } from "next/types";
import { lazy, Suspense, useEffect, useState } from "react";
import { gameStatsAtom } from "src/state";
import styles from "../styles/index.module.css";

const MultiplayerPhaserGame = lazy(
  () => import("../game/MultiplayerPhaserGame")
);

const MultiplayerPage: NextPage = () => {
  const router = useRouter();
  const apiService = useApiService();
  const [_gameStats, setGameStats] = useAtom(gameStatsAtom);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [redirectMessage, setRedirectMessage] = useState<string | null>(null);

  // Always validate session first to ensure cookie is still valid
  const sessionValidationQuery = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.validateSession();
    },
    enabled: !!apiService,
    retry: false,
  });

  const joinMultiplayerQuery = useQuery({
    queryKey: ["multiplayer"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.joinMultiplayer();
    },
    enabled: false,
  });

  // Handle session validation result
  useEffect(() => {
    if (sessionValidationQuery.isSuccess) {
      if (sessionValidationQuery.data?.success) {
        const userInfo = sessionValidationQuery.data.data;
        if (userInfo) {
          setGameStats((prev) => ({
            ...prev,
            user_id: userInfo.id,
            username: userInfo.username,
          }));

          // Session is valid, check for existing token or fetch new one
          const storedToken = sessionStorage.getItem("token");
          if (storedToken) {
            setToken(storedToken);
            setIsReady(true);
          } else {
            joinMultiplayerQuery.refetch();
          }
        }
      } else {
        // Session invalid, clear token and show message before redirect
        sessionStorage.removeItem("token");
        setRedirectMessage(
          "You must be signed in to play multiplayer. Redirecting..."
        );
        setTimeout(() => router.push("/"), 2000);
      }
    } else if (sessionValidationQuery.isError) {
      // Session validation failed, clear token and show message before redirect
      sessionStorage.removeItem("token");
      setRedirectMessage(
        "You must be signed in to play multiplayer. Redirecting..."
      );
      setTimeout(() => router.push("/"), 2000);
    }
  }, [
    sessionValidationQuery.isSuccess,
    sessionValidationQuery.isError,
    sessionValidationQuery.data,
  ]);

  useEffect(() => {
    if (
      joinMultiplayerQuery.isSuccess &&
      joinMultiplayerQuery.data?.data?.token
    ) {
      const newToken = joinMultiplayerQuery.data.data.token;
      sessionStorage.setItem("token", newToken);
      setToken(newToken);
      setIsReady(true);
    } else if (joinMultiplayerQuery.isError) {
      sessionStorage.removeItem("token");
      setRedirectMessage("Failed to connect to multiplayer. Redirecting...");
      setTimeout(() => router.push("/"), 2000);
    }
  }, [
    joinMultiplayerQuery.isSuccess,
    joinMultiplayerQuery.isError,
    joinMultiplayerQuery.data,
  ]);

  if (redirectMessage) {
    return (
      <div className={styles.container}>
        <p
          style={{ color: "#ff6b6b", fontSize: "1.2rem", textAlign: "center" }}
        >
          {redirectMessage}
        </p>
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
          {sessionValidationQuery.isLoading
            ? "Loading multiplayer..."
            : joinMultiplayerQuery.isFetching
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
      <MultiplayerPhaserGame token={token} />
    </Suspense>
  );
};

export default MultiplayerPage;
