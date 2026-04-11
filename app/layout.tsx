import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Candidate Search',
  description: 'Semantic search over 30,000 candidate profiles',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#dfe9ee] text-[#13212e] antialiased">{children}</body>
    </html>
  );
}
