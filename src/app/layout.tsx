import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ForgeProviders } from "@/components/forge/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Forge — The Body of the AI",
  description:
    "Forge gives the AI hands to build, eyes to see, and a fire of its own. Upload, build, deploy and verify — sovereign, on your own compute.",
  keywords: [
    "Forge",
    "CI/CD",
    "self-hosted",
    "Next.js",
    "ZIP",
    "TypeScript",
  ],
  authors: [{ name: "Forge" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Forge — The Body of the AI",
    description:
      "Forge gives the AI hands to build, eyes to see, and a fire of its own.",
    siteName: "Forge",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Forge — The Body of the AI",
    description:
      "Forge gives the AI hands to build, eyes to see, and a fire of its own.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html:
              "var __name=function(t,v){try{Object.defineProperty(t,'name',{value:v,configurable:true});}catch(e){}return t;};",
          }}
        />
        <ForgeProviders>{children}</ForgeProviders>
      </body>
    </html>
  );
}
