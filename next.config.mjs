/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLint non è incluso nello scaffold minimale: evita che il build fallisca.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
