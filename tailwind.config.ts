import type { Config } from "tailwindcss";

export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f0f13",
          raised: "#16161d",
          overlay: "#1c1c26",
          border: "#2a2a3a",
        },
        accent: {
          DEFAULT: "#7c3aed",
          hover: "#6d28d9",
          muted: "#7c3aed33",
        },
        brand: {
          purple: "#7c3aed",
          blue: "#3b82f6",
          pink: "#ec4899",
        },
        text: {
          primary: "#f4f4f8",
          secondary: "#a1a1b5",
          muted: "#5c5c72",
        },
        status: {
          online: "#22c55e",
          offline: "#6b7280",
          installing: "#f59e0b",
          error: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
        title: ['"Bebas Neue"', '"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "card-shine":
          "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 60%)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
  safelist: ["animate-card-flip-enter"],
} satisfies Config;
