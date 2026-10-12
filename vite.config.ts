import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Set when the Docker image is built (the git commit); "dev" when running from source.
    __APP_BUILD__: JSON.stringify(process.env.APP_VERSION || "dev"),
  },
  build: {
    // The owner's everyday test phone is an iPhone 6s on iOS 15.
    target: ["safari15", "es2020"],
    outDir: "dist",
  },
});
