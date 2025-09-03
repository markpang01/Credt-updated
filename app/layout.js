import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Credt - Credit Utilization Optimization',
  description: 'Time your payments to what credit models actually see. Optimize your credit utilization by timing payments before statement close dates.',
  keywords: 'credit utilization, credit score, credit cards, statement close date, plaid integration, credt',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-background text-foreground">
          {children}
        </div>
      </body>
    </html>
  )
}