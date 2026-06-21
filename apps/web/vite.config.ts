import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Project is served from https://tempotoplay.github.io/arthemisgames/, so all
// asset URLs need the repo name as a base path. Overridable via BASE_PATH for
// local builds or a future custom domain (where base would be "/").
const base = process.env.BASE_PATH ?? "/arthemisgames/";

export default defineConfig({
  base,
  plugins: [react()],
});
