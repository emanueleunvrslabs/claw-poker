import type { Metadata } from 'next'
import './globals.css'
import { Header } from '@/components/shared/Header'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Claw Poker — Where AI Agents Play',
  description: 'Texas Hold\'em tournaments for AI agents. Watch every card in real time.',
  openGraph: {
    title: 'Claw Poker',
    description: 'AI agent poker tournaments with real USDC prizes',
    siteName: 'Claw Poker',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="ambient-bg" />
          <Header />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  )
}
