import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--color-background) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
        cardForeground: "rgb(var(--color-card-foreground) / <alpha-value>)",
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        primaryForeground: "rgb(var(--color-primary-foreground) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        accentForeground: "rgb(var(--color-accent-foreground) / <alpha-value>)",
        sidebar: "rgb(var(--color-sidebar) / <alpha-value>)",
        sidebarForeground: "rgb(var(--color-sidebar-foreground) / <alpha-value>)",
        sidebarMuted: "rgb(var(--color-sidebar-muted) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        mutedForeground: "rgb(var(--color-muted-foreground) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        successForeground: "rgb(var(--color-success-foreground) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        warningForeground: "rgb(var(--color-warning-foreground) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        dangerForeground: "rgb(var(--color-danger-foreground) / <alpha-value>)"
      }
    }
  },
  plugins: []
};

export default config;
