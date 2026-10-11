import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The owner's everyday test phone is an iPhone 6s on iOS 15.
    target: ["safari15", "es2020"],
    outDir: "dist",
  },
});
