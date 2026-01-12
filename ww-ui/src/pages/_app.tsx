import { SocketProvider } from "@contexts/Socket";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "jotai";
import type { AppProps } from "next/app";
import Head from "next/head";
import { getStore } from "src/state";
import "../styles/globals.css";

const queryClient = new QueryClient();

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={getStore()}>
        <SocketProvider>
          <Head>
            <title>Wizard Warriors Game</title>
            <meta lang="en" />
            <meta charSet="UTF-8" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1.0"
            />
            <link rel="icon" href="/favicon.ico" />
            <link rel="apple-touch-icon" href="/favicon.ico" />
          </Head>
          <Component {...pageProps} />
        </SocketProvider>
      </Provider>
    </QueryClientProvider>
  );
}

export default MyApp;
