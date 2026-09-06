import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: [
          "var(--font-heading)",
          {
            fontVariationSettings: '"opsz" 32',
          },
        ],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        brand: {
          50: "#f5f3ff",
          100: "#ebe7ff",
          200: "#d9d1fe",
          300: "#c3b6fe",
          400: "#ae9dfd",
          500: "#9a88fc",
          600: "#7e67f2",
          700: "#6650d8",
          800: "#5140a9",
          900: "#3a2f78",
          950: "#1e1940",
        },
        ink: {
          700: "#1e1d29",
          800: "#16151f",
          850: "#100f18",
          900: "#0b0a11",
          950: "#07070b",
        },
        silver: "#6b6b76",
        dim: "#858585",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        lavender: "0 24px 60px -28px rgba(154, 136, 252, 0.45)",
        desk: "0 28px 80px -32px rgba(30, 25, 64, 0.28)",
      },
      keyframes: {
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(calc(-100% - var(--gap)))" },
        },
        "marquee-vertical": {
          from: { transform: "translateY(0)" },
          to: { transform: "translateY(calc(-100% - var(--gap)))" },
        },
        shine: {
          "0%": { backgroundPosition: "0% 0%" },
          "50%": { backgroundPosition: "100% 100%" },
          to: { backgroundPosition: "0% 0%" },
        },
        "shiny-text": {
          "0%, 90%, 100%": {
            backgroundPosition: "calc(-100% - var(--shiny-width)) 0",
          },
          "30%, 60%": {
            backgroundPosition: "calc(100% + var(--shiny-width)) 0",
          },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        ping: {
          "75%, 100%": { transform: "scale(2)", opacity: "0" },
        },
      },
      animation: {
        marquee: "marquee var(--duration) infinite linear",
        "marquee-vertical": "marquee-vertical var(--duration) linear infinite",
        shine: "shine var(--duration) infinite linear",
        "shiny-text": "shiny-text 8s infinite",
        rise: "rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
