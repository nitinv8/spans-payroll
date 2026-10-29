import type { MetadataRoute } from "next";

// Lets staff add the app to their phone's home screen (opens straight into /my).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spans Staff", short_name: "Spans Staff", start_url: "/my", scope: "/my", display: "standalone",
    background_color: "#f5f6f8", theme_color: "#142b38",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
