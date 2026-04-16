import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#183933",
        paper: "#fbfdff",
        mist: "#edf6f1",
        "brand-slate": "#1f4d46",
        accent: {
          DEFAULT: "#00704a",
          strong: "#005c3c",
          soft: "rgba(0, 112, 74, 0.12)",
        },
        mint: "#1a8a78",
        amber: "#c58b1a",
        rose: "#c45163",
      },
      boxShadow: {
        panel: "0 24px 60px rgba(24, 57, 51, 0.12)",
        card: "0 12px 30px rgba(24, 57, 51, 0.08)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        sans: ["Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "sans-serif"],
      },
      backgroundImage: {
        hero: "linear-gradient(145deg, rgba(17, 65, 59, 1), rgba(0, 112, 74, 0.98))",
        backdrop:
          "radial-gradient(circle at top left, rgba(0, 112, 74, 0.16), transparent 34%), radial-gradient(circle at top right, rgba(31, 77, 70, 0.1), transparent 28%), linear-gradient(180deg, #f7fbf9 0%, #eef5f1 50%, #e9f1ee 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
