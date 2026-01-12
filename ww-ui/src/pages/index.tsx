import { NextPage } from "next/types";
import { lazy, Suspense, useState } from "react";
/* import { MessageType } from "src/rpc/api/proto/ipc_pb"; */
import useApiService from "@hooks/useApiService";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Leaderboard from "src/components/Leaderboard";
import PlayerForm from "src/components/PlayerForm";
import styles from "../styles/index.module.css";

const Home: NextPage = () => {
  const [playable, setPlayable] = useState<boolean>();
  const apiService = useApiService();
  const PhaserGame = lazy(() => import("../game/app"));

  const { data: leaderboardData } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: async () => {
      if (!apiService) throw new Error("API service not available");
      const res = await apiService.getLeaderboard();
      if (res.success && res.data) {
        return res.data;
      }
      throw new Error("Failed to fetch leaderboard");
    },
    enabled: !!apiService,
    refetchInterval: 3000000,
  });

  return (
    <>
      {playable ? (
        <Suspense
          fallback={
            <div className={styles.container}>
              <Image
                src="/spinning-circles.svg"
                alt="Spinning indicator"
                width={64}
                height={64}
                loading="eager"
              />
            </div>
          }
        >
          <PhaserGame />
        </Suspense>
      ) : (
        <div className={styles.container}>
          <PlayerForm setPlayable={setPlayable} />
          <Leaderboard data={leaderboardData || null} />
        </div>
      )}
    </>
  );
};

export default Home;
