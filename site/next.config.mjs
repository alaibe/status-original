/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  basePath: process.env.PAGES_BASE_PATH ?? '',
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: import.meta.dirname },
  env: { NEXT_PUBLIC_BASE_PATH: process.env.PAGES_BASE_PATH ?? '' },
};
