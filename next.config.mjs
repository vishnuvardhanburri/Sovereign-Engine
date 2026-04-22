/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Hide Next.js dev UI indicators (the small "N" / build activity badge).
  // Useful for clean demos/screenshares.
  devIndicators: {
    buildActivity: false,
    appIsrStatus: false,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
