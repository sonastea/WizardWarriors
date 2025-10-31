import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

  return (
    <Html lang="en">
      <Head>
        {apiUrl && (
          <>
            <link rel="dns-prefetch" href={apiUrl} />
            <link rel="preconnect" href={apiUrl} crossOrigin="anonymous" />
          </>
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
