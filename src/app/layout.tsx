import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { Analytics } from '@vercel/analytics/react';

export const metadata: Metadata = {
  title: "Velocity Data | AI Barbell Tracker",
  description: "Track barbell velocity and estimate 1RM using just your phone camera. No expensive hardware required.",
  openGraph: {
    title: "Velocity Data | AI Barbell Tracker",
    description: "Track barbell velocity and estimate 1RM using just your phone camera.",
    url: "https://velocitydata.online",
    siteName: "Velocity Data",
    images: [
      {
        url: "https://velocitydata.online/og-image.jpg", // Create this image and place it in the public/ folder
        width: 1200,
        height: 630,
        alt: "Velocity Data App tracking a barbell lift in real-time",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Velocity Data | AI Barbell Tracker",
    description: "Track barbell velocity and estimate 1RM using just your phone camera.",
    images: ["https://velocitydata.online/og-image.jpg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
        {/* Render Analytics inside the body, outside of your main layout tree */}
        <Analytics />
      </body>
    </html>
  );
}