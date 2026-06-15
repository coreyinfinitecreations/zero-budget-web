import './globals.css';

export const metadata = {
  title: 'Zero Budget',
  description: 'Manage your zero-based budget',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
