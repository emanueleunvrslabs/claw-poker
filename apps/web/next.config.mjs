

const nextConfig = {
  transpilePackages: ['@claw-poker/shared'],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
      'react-native': false,
    }
    return config
  },
}

export default nextConfig
