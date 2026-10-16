import type { NextConfig } from 'next';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const nextConfig: NextConfig = {
  distDir: process.env.STOCKDEPTH_NEXT_DIST_DIR || (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  experimental: { cpus: 1 }
};

export default nextConfig;
