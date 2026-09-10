export default {
  theme: {
    screens: {
      sm: { max: '640px' },
    },
    fontFamily: {
      sans: ['Manrope', 'Noto Sans JP', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      mono: ['Manrope', 'Noto Sans JP', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
    },
    colors: {
      transparent: 'transparent',
      slate: {
        950: '#06101b',
        900: '#07111c',
        800: 'rgb(10 23 36 / 0.88)',
        700: '#102437',
        600: 'rgb(14 31 46 / 0.55)',
        500: 'rgb(7 18 29 / 0.7)',
        400: 'rgb(6 16 27 / 0.8)',
        300: 'rgb(11 27 42 / 0.65)',
        200: '#607a8e',
        100: '#a3b7c5',
        50: '#e9f1f6',
      },
      sky: {
        200: '#b9d8ed',
      },
      teal: {
        950: '#062023',
        700: '#1d434f',
        500: '#2ebfb8',
        300: '#66e6dd',
      },
      lime: {
        950: '#07171c',
        300: '#d7ef84',
      },
      amber: {
        300: '#f6ce74',
      },
      orange: {
        300: '#ffac86',
      },
    },
    spacing: {
      0: '0px',
      2: '2px',
      4: '4px',
      8: '8px',
      16: '16px',
      24: '24px',
      32: '32px',
      64: '64px',
      128: '128px',
    },
    height: {
      40: '40px',
    },
    fontSize: {
      10: ['10px', { lineHeight: '1.5' }],
      12: ['12px', { lineHeight: '1.5' }],
      14: ['14px', { lineHeight: '1.5' }],
      16: ['16px', { lineHeight: '1.5' }],
      24: ['24px', { lineHeight: '1.1' }],
      32: ['32px', { lineHeight: '1.1' }],
      64: ['64px', { lineHeight: '1.1' }],
    },
    lineHeight: {
      normal: '1.5',
      display: '1.1',
    },
    letterSpacing: {
      display: '-0.04em',
      section: '-0.04em',
      kicker: '0.16em',
      action: '0.04em',
      heading: '0.1em',
      chip: '0.08em',
    },
    boxShadow: {
      panel: '0 18px 48px rgb(0 0 0 / 0.22)',
      'drop-hover': 'inset 0 0 0 1px rgb(102 230 221 / 0.12)',
      'teal-300-glow': '0 0 22px rgb(102 230 221 / 0.12)',
      'lime-300-glow': '0 0 22px rgb(215 239 132 / 0.12)',
    },
    backgroundImage: {
      page: 'radial-gradient(circle at 65% 7%, rgb(36 93 116 / 0.16), transparent 28rem), radial-gradient(circle at 10% 92%, rgb(18 67 82 / 0.12), transparent 24rem)',
    },
  },
};
