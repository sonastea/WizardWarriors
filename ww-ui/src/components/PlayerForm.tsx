import { Dispatch, SetStateAction, useState } from "react";
import styles from "./PlayerForm.module.css";
import useApiService from "@hooks/useApiService";
import { PlayerSaveResponse } from "src/types/index.types";
import { useAtom } from "jotai";
import { gameStatsAtom } from "src/state";

const getCookie = (name: string) => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift();
};

const PlayerForm = ({
  setPlayable,
}: {
  setPlayable: Dispatch<SetStateAction<boolean | undefined>>;
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

  const login = async (e: React.MouseEvent) => {
    e.preventDefault();
    await apiService?.loginUser({ username, password }).then((res) => {
      if (res.success) {
        if (!res.data) handlePlayGame();
        setSaves(res.data);
        setGameStats((prev) => ({
          ...prev,
          user_id: parseInt(getCookie("ww-userId") || "0"),
          username,
        }));
      } else {
        setError(res.error || "Error logging in.");
      }
    });
  };

  const register = async (e: React.MouseEvent) => {
    e.preventDefault();
    await apiService?.registerUser({ username, password }).then((res) => {
      if (res.success) {
        setPlayable(true);
        setGameStats((prev) => ({
          ...prev,
          user_id: res.data!.id,
          username,
        }));
      }
    });
  };

  const handleSaveSelection = (save: PlayerSaveResponse) => {
    setSelectedSave(save === selectedSave ? null : save);
  };

  const playGame = () => {
    setPlayable(true);
  };

  const handlePlayGame = async () => {
    if (selectedSave) {
      const save = await apiService?.getPlayerSave(selectedSave.game_id);
      if (save?.data?.is_game_over || !save?.data?.game_is_active) {
        alert("This save is no longer playable.");
        return;
      }
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
                key={save.id}
                className={`${styles.save} ${selectedSave?.id === save.id ? styles.selectedSave : ""} ${
                  isDisabled ? styles.disabledSave : ""
                }`}
                onClick={() => {
                  if (!isDisabled) handleSaveSelection(save);
                }}
              >
                <p>Save ID: {save.id}</p>
                <p>
                  User ID: <span className={styles.value}>{save.user_id}</span>
                </p>
                <p>
                  Max Level:{" "}
                  <span className={styles["max-level"]}>{save.max_level}</span>
                </p>
                <p>Created: {new Date(save.created_at).toLocaleString()}</p>
                <p>Updated: {new Date(save.updated_at).toLocaleString()}</p>
                <p>Game Over: {save.is_game_over ? "Yes" : "No"}</p>
              </div>
            );
          })}
        </div>
        <div className={styles.buttonContainer}>
          <button
            className={`${styles.button} ${styles.grayButton}`}
            onClick={() => setSaves(undefined)}
          >
            Back
          </button>
          <button className={styles.button} onClick={() => handlePlayGame()}>
            {selectedSave ? "Continue" : "Start New Game"}
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
        autoComplete="password"
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
          disabled={disableButton}
          onClick={login}
        >
          Login
        </button>
        <button
          className={`${styles.button} ${styles.grayButton}`}
          aria-label="Register"
          disabled={disableButton}
          onClick={register}
        >
          Register
        </button>
      </div>
    </form>
  );
};

export default PlayerForm;
