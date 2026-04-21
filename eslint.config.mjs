import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'scripts/**',
      'worker/**',
      'app/api/**',
      // Large legacy backend modules are typechecked by `tsc`; keep lint focused on frontend safety.
      'lib/**',
      '!lib/ai/**',
      '!lib/learning/**',
      '!lib/delivery/**',
      '!lib/scheduling/**',
      '!lib/contacts/**',
      '!lib/campaign/**',
      '!lib/control-loop.ts',
      '!lib/self-healing.ts',
      '!lib/metrics.ts',
      '!lib/queue-control.ts',
      '!lib/redis.ts',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: ['components/voice-assistant.tsx'],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]

export default config
