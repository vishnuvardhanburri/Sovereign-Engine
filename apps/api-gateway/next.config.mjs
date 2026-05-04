/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
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
