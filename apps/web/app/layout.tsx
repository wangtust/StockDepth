import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { getAccountForUser, getPublicUser } from '@/lib/db/queries';
import { SWRConfig } from 'swr';

export const metadata: Metadata = {
  title: 'StockDepth',
  description:
    'A multi-agent stock research platform for structured investment analysis.'
};

export const viewport: Viewport = {
  maximumScale: 1
};

const manrope = Manrope({ subsets: ['latin'] });

function serializeForClient<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const [publicUser, account] = await Promise.all([
    getPublicUser(),
    getAccountForUser()
  ]);

  return (
    <html
      lang="en"
      className={`bg-white dark:bg-gray-950 text-black dark:text-white ${manrope.className}`}
    >
      <body className="min-h-[100dvh] bg-gray-50">
        <SWRConfig
          value={{
            fallback: {
              '/api/user': serializeForClient(publicUser),
              '/api/account': serializeForClient(account)
            }
          }}
        >
          {children}
        </SWRConfig>
      </body>
    </html>
  );
}
