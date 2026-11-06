import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const docs = ["README.md", "CHANGELOG.md", "CODE_WALKTHROUGH.md", "DEPLOYMENT.md", "PROJECT_GUIDE.md"];

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        ...docs.map(file => fileURLToPath(new URL(`../${file}`, import.meta.url))),
      ],
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
});
