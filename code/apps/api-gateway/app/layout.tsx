import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from '@/components/providers'
import { NextDevToolsOff } from '@/components/next-devtools-off'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })
const analyticsEnabled = process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS === 'true'

export const metadata: Metadata = {
  title: 'Sovereign Engine',
  description: 'Deliverability Operating System for compliant outbound infrastructure.',
  applicationName: 'Sovereign Engine',
  metadataBase: new URL('https://sovereign-engine.local'),
  icons: {
    shortcut: '/favicon.ico',
    icon: [
      {
        url: '/favicon.ico',
        sizes: '32x32',
      },
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
        sizes: '32x32',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
        sizes: '32x32',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geist.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground transition-colors duration-200`}
      >
        <Providers>
          <NextDevToolsOff />
          {children}
          {analyticsEnabled && <Analytics />}
        </Providers>
      </body>
    </html>
  )
}
