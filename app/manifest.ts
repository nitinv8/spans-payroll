import type { MetadataRoute } from "next";

// Lets staff add the app to their phone's home screen (opens straight into /my).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spans Payroll", short_name: "Spans Payroll", start_url: "/my", scope: "/my", display: "standalone",
    background_color: "#f5f6f8", theme_color: "#142b38",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
