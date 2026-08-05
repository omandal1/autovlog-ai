import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#0f1724",
        foreground: "#f5f7fb",
        accent: "#fdba74",
        panel: "#152235",
        stroke: "#2e3d52"
      },
      boxShadow: {
        glow: "0 20px 60px rgba(253, 186, 116, 0.12)"
      },
      backgroundImage: {
        grain:
          "radial-gradient(circle at top left, rgba(253, 186, 116, 0.22), transparent 28%), radial-gradient(circle at top right, rgba(56, 189, 248, 0.18), transparent 24%), linear-gradient(135deg, #09101c 0%, #0f1724 42%, #111827 100%)"
      }
    }
  },
  plugins: []
};

export default config;
