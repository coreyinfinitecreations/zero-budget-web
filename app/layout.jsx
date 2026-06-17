import './globals.css';

export const metadata = {
  title: 'Zero Budget',
  description: 'Manage your zero-based budget',
};

// Applies the saved theme before paint so there's no light/dark flash.
const themeInit = `(function(){try{var t=localStorage.getItem('zb-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
