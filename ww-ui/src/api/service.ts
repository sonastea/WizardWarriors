import {
  ApiResponse,
  GameStats,
  GameStatsResponse,
  GetPlayerSaveApiResponse,
  JoinMultiplayerApiResponse,
  PlayerSaveApiResponse,
  SavePlayerSaveApiResponse,
  UserCredentials,
  UserResponse,
  ValidateSessionApiResponse,
} from "src/types/index.types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost";

class ApiService {
  private baseUrl = BASE_URL;

  async registerUser(
    credentials: UserCredentials
  ): Promise<ApiResponse<UserResponse>> {
    try {
      const response = await fetch(this.baseUrl + "/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
        credentials: "include",
      });

      const result: ApiResponse<UserResponse> = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to register user.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async loginUser(
    credentials: UserCredentials
  ): Promise<PlayerSaveApiResponse> {
    try {
      const response = await fetch(this.baseUrl + "/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
        credentials: "include",
      });

      const result: PlayerSaveApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to login user.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async getLeaderboard(): Promise<ApiResponse<GameStatsResponse[]>> {
    try {
      const response = await fetch(this.baseUrl + "/api/leaderboard", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result: ApiResponse<GameStatsResponse[]> = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to retrieve leaderboard.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async getPlayerSave(gameId: number): Promise<GetPlayerSaveApiResponse> {
    try {
      const response = await fetch(this.baseUrl + "/api/player-save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ game_id: gameId }),
      });

      const result: GetPlayerSaveApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to get player save.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async saveGame(gamestats: GameStats): Promise<SavePlayerSaveApiResponse> {
    try {
      const response = await fetch(this.baseUrl + "/api/save-game", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(gamestats),
        credentials: "include",
      });

      const result: SavePlayerSaveApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async joinMultiplayer(guestId?: string): Promise<JoinMultiplayerApiResponse> {
    try {
      const response = await fetch(this.baseUrl + "/api/join-multiplayer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: guestId ? JSON.stringify({ guestId }) : undefined,
      });

      const result: JoinMultiplayerApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(result.error);
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async validateSession(): Promise<ValidateSessionApiResponse> {
    try {
      const response = await fetch(this.baseUrl + "/api/validate-session", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const result: ValidateSessionApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Session validation failed.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async getPlayerSaves(): Promise<PlayerSaveApiResponse> {
    try {
      const response = await fetch(this.baseUrl + "/api/player-saves", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const result: PlayerSaveApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to get player saves.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  async logout(): Promise<ApiResponse<{ message: string }>> {
    try {
      const response = await fetch(this.baseUrl + "/api/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const result: ApiResponse<{ message: string }> = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to logout.");
      }

      return result;
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  private handleError<T>(error: unknown): ApiResponse<T> {
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
      };
    } else {
      return {
        success: false,
        error: "Unexpected error occurred.",
      };
    }
  }
}

export default ApiService;
