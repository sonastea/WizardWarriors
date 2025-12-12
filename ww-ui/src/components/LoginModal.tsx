import useApiService from "@hooks/useApiService";
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import styles from "./LoginModal.module.css";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (userInfo: { id: number; username: string }) => void;
}

export const getCookie = (name: string): string => {
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [key, value] = cookie.split("=");
    if (key === name) return decodeURIComponent(value);
  }
  return "-1";
};

const LoginModal = ({ isOpen, onClose, onLoginSuccess }: LoginModalProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const apiService = useApiService();

  const loginMutation = useMutation({
    mutationFn: async () => {
      if (!apiService) throw new Error("API service not available");
      return apiService.loginUser({ username, password });
    },
    onSuccess: (res) => {
      if (res.success) {
        const userId = parseInt(getCookie("ww-userId"));
        onLoginSuccess({ id: userId, username });
        onClose();
      } else {
        setError(res.error || "Invalid username or password");
      }
    },
    onError: () => {
      setError("An error occurred while logging in");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter both username and password");
      return;
    }
    setError("");
    loginMutation.mutate();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <button className={styles.closeButton} onClick={onClose}>
          &times;
        </button>
        <h2 className={styles.title}>Sign In</h2>
        <p className={styles.subtitle}>
          Sign in to play as your registered account
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <div className={styles.error}>{error}</div>}

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={styles.input}
            autoComplete="username"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
            autoComplete="current-password"
          />

          <button
            type="submit"
            className={styles.submitButton}
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginModal;
