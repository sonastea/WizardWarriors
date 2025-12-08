import useApiService from "@hooks/useApiService";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import React, { Dispatch, SetStateAction, useState, useEffect } from "react";
import { gameStatsAtom, setGameSaved } from "src/state";
import { PlayerSaveResponse } from "src/types/index.types";
import styles from "./PlayerForm.module.css";
import { useSocket } from "@contexts/Socket";

export const getCookie = (name: string): string => {
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [key, value] = cookie.split("=");
    if (key === name) return decodeURIComponent(value);
  }
  return "-1";
};

const PlayerForm = ({
  setPlayable,
  onMultiplayerJoin,
}: {
  setPlayable: Dispatch<SetStateAction<boolean | undefined>>;
  onMultiplayerJoin: () => void;
}) => {
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [saves, setSaves] = useState<PlayerSaveResponse[] | undefined>(
    undefined
  );
  const [selectedSave, setSelectedSave] = useState<PlayerSaveResponse | null>(
    null
  );

  const disableButton = !username || !password;
  const apiService = useApiService();
  const [_gameStats, setGameStats] = useAtom(gameStatsAtom);

  const loginMutation = useMutation({
    mutationFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.loginUser({ username, password });
    },
    onSuccess: (res) => {
      if (res.success) {
        if (!res.data) handlePlayGame();
        setSaves(res.data);
        setGameStats((prev) => ({
          ...prev,
          user_id: parseInt(getCookie("ww-userId")),
          username,
        }));
      } else {
        setError(res.error || "Error logging in.");
      }
    },
    onError: () => {
      setError("Error logging in.");
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.registerUser({ username, password });
    },
    onSuccess: (res) => {
      if (res.success) {
        setPlayable(true);
        setGameStats((prev) => ({
          ...prev,
          user_id: parseInt(getCookie("ww-userId")),
          username: username,
        }));
      } else {
        setError(res.error || "Error registering.");
      }
    },
    onError: () => {
      setError("Error registering.");
    },
  });

  const joinMultiplayerQuery = useQuery({
    queryKey: ["multiplayer"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.joinMultiplayer();
    },
    enabled: false,
  });

  const sessionValidationQuery = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.validateSession();
    },
    enabled: !!apiService,
    retry: false,
  });

  useEffect(() => {
    const handleMultiplayerJoin = async () => {
      if (
        joinMultiplayerQuery.isSuccess &&
        joinMultiplayerQuery.data?.data?.token
      ) {
        const token = joinMultiplayerQuery.data.data.token;

        try {
          sessionStorage.setItem("token", token);
          onMultiplayerJoin();
        } catch (err) {
          console.error("Failed to connect to multiplayer:", err);
          setError("Failed to connect to multiplayer server");
        }
      }
    };

    handleMultiplayerJoin();
  }, [
    joinMultiplayerQuery.isSuccess,
    joinMultiplayerQuery.data,
    onMultiplayerJoin,
  ]);

  const playerSavesQuery = useQuery({
    queryKey: ["playerSaves"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.getPlayerSaves();
    },
    enabled: false,
    retry: false,
  });

  useEffect(() => {
    if (sessionValidationQuery.isSuccess && sessionValidationQuery.data?.success) {
      const userInfo = sessionValidationQuery.data.data;
      if (userInfo) {
        setUsername(userInfo.username);
        setGameStats((prev) => ({
          ...prev,
          user_id: userInfo.id,
          username: userInfo.username,
        }));
        playerSavesQuery.refetch();
      }
    }
  }, [sessionValidationQuery.isSuccess, sessionValidationQuery.data]);

  useEffect(() => {
    if (playerSavesQuery.isSuccess && playerSavesQuery.data?.success) {
      const savesData = playerSavesQuery.data.data;
      
      if (!savesData || savesData.length === 0) {
        handlePlayGame();
      } else {
        setSaves(savesData);
      }
    }
  }, [playerSavesQuery.isSuccess, playerSavesQuery.data]);

  const login = async (e: React.MouseEvent) => {
    e.preventDefault();
    loginMutation.mutate();
  };

  const register = async (e: React.MouseEvent) => {
    e.preventDefault();
    registerMutation.mutate();
  };

  const handleSaveSelection = (save: PlayerSaveResponse) => {
    setSelectedSave(save === selectedSave ? null : save);
  };

  const playGame = () => {
    setPlayable(true);
    setGameSaved(false);
  };

  const loadSaveMutation = useMutation({
    mutationFn: async (gameId: number) => {
      if (!apiService) throw new Error("API service not available");
      return apiService.getPlayerSave(gameId);
    },
    onSuccess: (save) => {
      if (save?.data?.is_game_over || !save?.data?.game_is_active) {
        alert("This save is no longer playable.");
        return;
      }
      if (save.data) {
        setGameStats({
          game_id: save.data.game_id,
          username,
          user_id: save.data.user_id,
          team_deaths: save.data.team_deaths,
          team_kills: save.data.team_kills,
          player_level: save.data.player_level,
          player_kills: save.data.player_kills,
          player_kills_at_level: save.data.player_kills_at_level,
          total_allies: save.data.total_allies,
          total_enemies: save.data.total_enemies,
          is_game_over: save.data.is_game_over,
          game_created_at: save.data.game_created_at,
          game_updated_at: save.data.game_updated_at,
        });
      }
      playGame();
    },
    onError: () => {
      alert("Error loading save.");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.logout();
    },
    onSuccess: () => {
      setSaves(undefined);
      setUsername("");
      setPassword("");
      setSelectedSave(null);
      setGameStats((prev) => ({
        ...prev,
        user_id: -1,
        username: "",
      }));
    },
    onError: () => {
      setError("Error logging out.");
    },
  });

  const handlePlayGame = async () => {
    if (selectedSave) {
      loadSaveMutation.mutate(selectedSave.game_id);
    } else {
      playGame();
    }
  };

  if (saves) {
    return (
      <div className={styles.savesContainer}>
        <h2>Player Saves</h2>
        <div className={styles.savesGrid}>
          {saves.map((save) => {
            const isDisabled = !save.game_is_active || save.is_game_over;

            return (
              <div
                key={save.game_id}
                className={`${styles.save} ${selectedSave?.game_id === save.game_id ? styles.selectedSave : ""} ${
                  isDisabled ? styles.disabledSave : ""
                }`}
                onClick={() => {
                  if (!isDisabled) handleSaveSelection(save);
                }}
              >
                <p>Game ID: {save.game_id}</p>
                <p>
                  User ID: <span className={styles.value}>{save.user_id}</span>
                </p>
                <p>
                  Total Kills:{" "}
                  <span className={styles["max-level"]}>
                    {save.player_kills}
                  </span>
                </p>
                <p>
                  Total Allies:{" "}
                  <span className={styles["max-level"]}>
                    {save.total_allies}
                  </span>
                </p>
                <p>
                  Total Enemies:{" "}
                  <span className={styles["max-level"]}>
                    {save.total_enemies}
                  </span>
                </p>
                <p className={styles.gameOver}>
                  Game Over:{" "}
                  <span
                    className={
                      save.is_game_over ? styles.gameOverYes : styles.gameOverNo
                    }
                  >
                    {save.is_game_over ? "Yes" : "No"}
                  </span>
                </p>
                <p>Created: {new Date(save.created_at).toLocaleString()}</p>
                <p>Updated: {new Date(save.updated_at).toLocaleString()}</p>
              </div>
            );
          })}
        </div>
        <div className={styles.buttonContainer}>
          <button
            className={`${styles.button} ${styles.grayButton}`}
            onClick={() => logoutMutation.mutate()}
            disabled={loadSaveMutation.isPending || logoutMutation.isPending}
          >
            {logoutMutation.isPending ? "Logging out..." : "Logout"}
          </button>
          <button
            className={styles.button}
            onClick={() => handlePlayGame()}
            disabled={loadSaveMutation.isPending || logoutMutation.isPending}
          >
            {loadSaveMutation.isPending
              ? "Loading..."
              : selectedSave
                ? "Continue"
                : "Start New Game"}
          </button>
        </div>
        <div className={styles.buttonContainer}>
          <button
            className={`${styles.button} ${styles.buttonMultiplayer}`}
            onClick={() => joinMultiplayerQuery.refetch()}
            disabled={joinMultiplayerQuery.isFetching}
          >
            {joinMultiplayerQuery.isFetching
              ? "Connecting..."
              : "Play Multiplayer"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form}>
      <div className={styles.errorContainer}>
        {error && <p className={styles.error}>{error}</p>}
      </div>
      <input
        name="username"
        autoComplete="username"
        className={`${styles.input} ${error ? styles.inputError : ""}`}
        placeholder="Player name"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          if (error) setError("");
        }}
      />
      <input
        name="password"
        autoComplete="false"
        className={`${styles.input} ${error ? styles.inputError : ""}`}
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (error) setError("");
        }}
      />
      <div className={styles.buttonContainer}>
        <button
          className={styles.button}
          aria-label="Login"
          disabled={disableButton || loginMutation.isPending}
          onClick={login}
        >
          {loginMutation.isPending ? "Logging in..." : "Login"}
        </button>
        <button
          className={`${styles.button} ${styles.grayButton}`}
          aria-label="Register"
          disabled={disableButton || registerMutation.isPending}
          onClick={register}
        >
          {registerMutation.isPending ? "Registering..." : "Register"}
        </button>
      </div>
    </form>
  );
};

export default PlayerForm;
