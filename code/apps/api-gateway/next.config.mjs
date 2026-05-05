/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Allow Playwright (and other tools) to hit the dev server on 127.0.0.1 without
  // Next.js dev-origin restrictions breaking hydration/HMR clients.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  typescript: {
    ignoreBuildErrors: true,
  },
  // Hide Next.js dev UI indicators (the small "N" badge).
  // Useful for clean demos/screenshares.
  // (Next.js 16+ supports `devIndicators: false`.)
  devIndicators: false,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
