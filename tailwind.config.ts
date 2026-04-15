import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#173542",
        paper: "#fbfefd",
        mist: "#eef7f4",
        "brand-slate": "#35576d",
        accent: {
          DEFAULT: "#00704A",
          strong: "#00573B",
          soft: "rgba(0, 112, 74, 0.14)",
        },
        mint: "#14856C",
        amber: "#d18b16",
        rose: "#c45163",
      },
      boxShadow: {
        panel: "0 24px 60px rgba(19, 53, 66, 0.12)",
        card: "0 12px 34px rgba(25, 73, 80, 0.08)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        sans: ["Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "sans-serif"],
      },
      backgroundImage: {
        hero: "linear-gradient(140deg, rgba(20, 59, 73, 0.98), rgba(0, 112, 74, 0.96))",
        backdrop:
          "radial-gradient(circle at top left, rgba(20, 133, 108, 0.18), transparent 32%), radial-gradient(circle at top right, rgba(53, 87, 109, 0.14), transparent 26%), linear-gradient(180deg, #f8fcfb 0%, #eef6f3 45%, #edf5f4 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
