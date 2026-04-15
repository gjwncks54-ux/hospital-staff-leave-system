import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        paper: "#fcfdff",
        mist: "#f4f7fb",
        accent: {
          DEFAULT: "#2c6bed",
          strong: "#1f57cb",
          soft: "rgba(44, 107, 237, 0.14)",
        },
        mint: "#2ea597",
        amber: "#f59e0b",
        rose: "#ef5b62",
      },
      boxShadow: {
        panel: "0 16px 40px rgba(35, 48, 76, 0.12)",
        card: "0 8px 28px rgba(36, 49, 73, 0.08)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        sans: ["Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "sans-serif"],
      },
      backgroundImage: {
        hero: "linear-gradient(140deg, rgba(18, 33, 68, 0.94), rgba(44, 107, 237, 0.94))",
        backdrop:
          "radial-gradient(circle at top left, rgba(44, 107, 237, 0.18), transparent 32%), linear-gradient(180deg, #f8fbff 0%, #eef4fb 48%, #f4f7fb 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
