import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        line: "#d8dee8",
        panel: "#f7f9fc",
        newl: {
          blue: "#1455d9",
          green: "#16885a",
          red: "#c7372f"
        }
      }
    }
  },
  plugins: []
};

export default config;
