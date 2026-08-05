declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }

  interface ConvertibleImage {
    convert(): Promise<Buffer | Uint8Array>;
  }

  interface HeicConvert {
    (options: ConvertOptions): Promise<Buffer | Uint8Array>;
    all(options: ConvertOptions): Promise<ConvertibleImage[]>;
  }

  const convert: HeicConvert;
  export = convert;
}

