import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/ONNX packages must not be bundled by Next.
  serverExternalPackages: ["postgres", "@huggingface/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
