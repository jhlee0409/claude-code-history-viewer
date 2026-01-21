/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      /* Typography */
      fontFamily: {
        sans: ["IBM Plex Sans", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        display: ["IBM Plex Sans", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      fontSize: {
        "3xs": ["0.625rem", { lineHeight: "0.8125rem" }],
        "2xs": ["0.6875rem", { lineHeight: "0.9375rem" }],
        "3xl": ["1.9375rem", { lineHeight: "2.3125rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.3125rem", { lineHeight: "2.5625rem", letterSpacing: "-0.025em" }],
        "5xl": ["3.0625rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
        "6xl": ["3.8125rem", { lineHeight: "1", letterSpacing: "-0.035em" }],
        "7xl": ["4.5625rem", { lineHeight: "1", letterSpacing: "-0.04em" }],
      },
      letterSpacing: {
        tightest: "-0.05em",
        tighter: "-0.04em",
        tight: "-0.025em",
        wide: "0.025em",
        wider: "0.05em",
        widest: "0.1em",
        mega: "0.2em",
      },

      /* Colors - Semantic mapping to CSS variables (OKLCH) */
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        /* Additional semantic colors */
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)",
        },
        info: {
          DEFAULT: "var(--info)",
          foreground: "var(--info-foreground)",
        },
        /* Tool-specific colors (Industrial Palette) */
        tool: {
          code: "var(--tool-code)",
          file: "var(--tool-file)",
          search: "var(--tool-search)",
          task: "var(--tool-task)",
          system: "var(--tool-system)",
          git: "var(--tool-git)",
          web: "var(--tool-web)",
          mcp: "var(--tool-mcp)",
          document: "var(--tool-document)",
          terminal: "var(--tool-terminal)",
        },
        /* Thinking block colors */
        thinking: {
          DEFAULT: "var(--thinking)",
          foreground: "var(--thinking-foreground)",
          border: "var(--thinking-border)",
          muted: "var(--thinking-muted)",
        },
        /* Search highlight colors */
        highlight: {
          DEFAULT: "var(--highlight)",
          current: "var(--highlight-current)",
          foreground: "var(--highlight-foreground)",
        },
        /* Dashboard metric colors */
        metric: {
          green: "var(--metric-green)",
          purple: "var(--metric-purple)",
          blue: "var(--metric-blue)",
          amber: "var(--metric-amber)",
          pink: "var(--metric-pink)",
          teal: "var(--metric-teal)",
        },
        /* Heatmap colors */
        heatmap: {
          empty: "var(--heatmap-empty)",
          low: "var(--heatmap-low)",
          medium: "var(--heatmap-medium)",
          high: "var(--heatmap-high)",
        },
      },

      /* Border Radius */
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },

      /* Spacing - 4px base scale */
      spacing: {
        "4.5": "1.125rem",
        "5.5": "1.375rem",
        "18": "4.5rem",
        "22": "5.5rem",
      },

      /* Box Shadow - Using CSS variables for theme support */
      boxShadow: {
        "xs": "var(--shadow-xs)",
        "sm": "var(--shadow-sm)",
        "DEFAULT": "var(--shadow-sm)",
        "md": "var(--shadow-md)",
        "lg": "var(--shadow-lg)",
        "xl": "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
        "inner": "var(--shadow-inner)",
        "ring": "var(--shadow-ring)",
        "glow": "var(--shadow-glow)",
        "glow-accent": "var(--shadow-glow-accent)",
        "glow-green": "var(--glow-green)",
        "glow-purple": "var(--glow-purple)",
        "glow-blue": "var(--glow-blue)",
        "glow-amber": "var(--glow-amber)",
        "glass": "var(--glass-shadow)",
        "none": "none",
      },

      /* Keyframes & Animations */
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-left": {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-right": {
          "0%": { opacity: "0", transform: "translateX(-16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.9)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "scale-out": {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.9)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
        "breathe": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.7", transform: "scale(0.98)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px oklch(0.75 0.18 55 / 0.2)" },
          "50%": { boxShadow: "0 0 35px oklch(0.75 0.18 55 / 0.4)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1))",
        "fade-out": "fade-out 0.2s var(--ease-in-out-circ, cubic-bezier(0.85, 0, 0.15, 1))",
        "slide-up": "slide-up 0.4s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1))",
        "slide-down": "slide-down 0.4s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1))",
        "slide-left": "slide-left 0.4s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1))",
        "slide-right": "slide-right 0.4s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1))",
        "scale-in": "scale-in 0.25s var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1))",
        "scale-out": "scale-out 0.2s var(--ease-in-out-circ, cubic-bezier(0.85, 0, 0.15, 1))",
        "shimmer": "shimmer 1.8s ease-in-out infinite",
        "pulse-subtle": "pulse-subtle 2.5s ease-in-out infinite",
        "breathe": "breathe 3s var(--ease-in-out-circ, cubic-bezier(0.85, 0, 0.15, 1)) infinite",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
      },

      /* Backdrop Blur */
      backdropBlur: {
        xs: "2px",
        "2xl": "40px",
        "3xl": "64px",
      },

      /* Backdrop Saturate */
      backdropSaturate: {
        "150": "1.5",
        "180": "1.8",
        "200": "2",
      },

      /* Transition */
      transitionDuration: {
        "50": "50ms",
        "150": "150ms",
        "250": "250ms",
        "350": "350ms",
        "400": "400ms",
        "600": "600ms",
      },
      transitionTimingFunction: {
        "out-expo": "var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1))",
        "out-back": "var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1))",
        "in-out-circ": "var(--ease-in-out-circ, cubic-bezier(0.85, 0, 0.15, 1))",
        "spring": "var(--ease-spring, cubic-bezier(0.175, 0.885, 0.32, 1.275))",
      },

      /* Z-Index Scale */
      zIndex: {
        "dropdown": "100",
        "sticky": "200",
        "modal": "300",
        "popover": "400",
        "tooltip": "500",
        "toast": "600",
      },

      /* Background Image - Gradients */
      backgroundImage: {
        "gradient-subtle": "var(--gradient-subtle)",
        "gradient-accent": "var(--gradient-accent)",
        "gradient-surface": "var(--gradient-surface)",
        "gradient-shimmer": "var(--gradient-shimmer)",
        "gradient-glow": "var(--gradient-glow)",
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    // Custom prose-xs variant for compact markdown rendering
    function({ addComponents }) {
      addComponents({
        '.prose-xs': {
          fontSize: '0.75rem',
          lineHeight: '1.5',
          '& p': {
            marginTop: '0.375em',
            marginBottom: '0.375em',
          },
          '& h1': {
            fontSize: '0.9375rem',
            marginTop: '0',
            marginBottom: '0.375em',
            lineHeight: '1.3',
          },
          '& h2': {
            fontSize: '0.875rem',
            marginTop: '0.75em',
            marginBottom: '0.375em',
            lineHeight: '1.3',
          },
          '& h3': {
            fontSize: '0.8125rem',
            marginTop: '0.75em',
            marginBottom: '0.375em',
            lineHeight: '1.4',
          },
          '& h4, & h5, & h6': {
            fontSize: '0.75rem',
            marginTop: '0.75em',
            marginBottom: '0.375em',
          },
          '& ul': {
            marginTop: '0.375em',
            marginBottom: '0.375em',
            paddingLeft: '1.25em',
            listStyleType: 'disc',
          },
          '& ol': {
            marginTop: '0.375em',
            marginBottom: '0.375em',
            paddingLeft: '1.25em',
            listStyleType: 'decimal',
          },
          '& ul ul': {
            listStyleType: 'circle',
          },
          '& ul ul ul': {
            listStyleType: 'square',
          },
          '& li': {
            marginTop: '0.125em',
            marginBottom: '0.125em',
            paddingLeft: '0.25em',
          },
          '& li::marker': {
            color: 'var(--muted-foreground)',
          },
          '& pre': {
            fontSize: '0.6875rem',
            lineHeight: '1.4',
            marginTop: '0.5em',
            marginBottom: '0.5em',
            padding: '0.375em 0.5em',
            borderRadius: '0.25rem',
          },
          '& code': {
            fontSize: '0.6875rem',
            padding: '0.0625em 0.1875em',
            borderRadius: '0.1875rem',
          },
          '& blockquote': {
            marginTop: '0.5em',
            marginBottom: '0.5em',
            paddingLeft: '0.5em',
            fontStyle: 'italic',
          },
          '& hr': {
            marginTop: '0.75em',
            marginBottom: '0.75em',
          },
          '& table': {
            fontSize: '0.6875rem',
            marginTop: '0.75em',
            marginBottom: '0.75em',
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          },
          '& thead': {
            backgroundColor: 'var(--muted)',
          },
          '& th': {
            padding: '0.5em 0.75em',
            fontWeight: '600',
            textAlign: 'left',
            color: 'var(--foreground)',
            borderBottom: '1px solid var(--border)',
          },
          '& td': {
            padding: '0.4em 0.75em',
            borderBottom: '1px solid var(--border)',
            color: 'var(--foreground)',
          },
          '& tbody tr:last-child td': {
            borderBottom: 'none',
          },
          '& thead th:not(:last-child), & tbody td:not(:last-child)': {
            borderRight: '1px solid var(--border)',
          },
          '& img': {
            marginTop: '0.5em',
            marginBottom: '0.5em',
            borderRadius: '0.25rem',
          },
          /* Links */
          '& a': {
            color: 'var(--primary)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            textDecorationColor: 'var(--primary)',
            textDecorationThickness: '1px',
            transition: 'color 0.15s, text-decoration-color 0.15s',
          },
          '& a:hover': {
            color: 'var(--accent)',
            textDecorationColor: 'var(--accent)',
          },
          /* Text formatting */
          '& strong, & b': {
            fontWeight: '600',
            color: 'var(--foreground)',
          },
          '& em, & i': {
            fontStyle: 'italic',
          },
          '& del, & s': {
            textDecoration: 'line-through',
            color: 'var(--muted-foreground)',
          },
          '& mark': {
            backgroundColor: 'var(--highlight)',
            color: 'var(--highlight-foreground)',
            padding: '0.0625em 0.25em',
            borderRadius: '0.125rem',
          },
          '& kbd': {
            fontSize: '0.625rem',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            backgroundColor: 'var(--muted)',
            border: '1px solid var(--border)',
            borderRadius: '0.25rem',
            padding: '0.125em 0.375em',
            boxShadow: '0 1px 0 var(--border)',
          },
          '& sub': {
            fontSize: '0.75em',
            verticalAlign: 'sub',
          },
          '& sup': {
            fontSize: '0.75em',
            verticalAlign: 'super',
          },
          '& abbr[title]': {
            textDecoration: 'underline dotted',
            cursor: 'help',
          },
          /* Nested ordered lists */
          '& ol ol': {
            listStyleType: 'lower-alpha',
          },
          '& ol ol ol': {
            listStyleType: 'lower-roman',
          },
          /* Inline code (not in pre) */
          '& :not(pre) > code': {
            backgroundColor: 'var(--muted)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          },
          /* Code inside pre (reset padding) */
          '& pre code': {
            padding: '0',
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: '0',
          },
        },
      });
    },
  ],
};
