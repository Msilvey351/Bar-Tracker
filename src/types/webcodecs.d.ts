// WebCodecs API type declarations

interface VideoDecoderConfig {
  codec:   string;
  width?:  number;
  height?: number;
}

interface VideoDecoderSupport {
  supported: boolean;
  config:    VideoDecoderConfig;
}

interface VideoDecoderInit {
  output: (frame: VideoFrame) => void;
  error:  (e: DOMException) => void;
}

interface EncodedVideoChunkInit {
  type:      "key" | "delta";
  timestamp: number;
  duration?: number;
  data:      BufferSource;
}

declare class EncodedVideoChunk {
  constructor(init: EncodedVideoChunkInit);
  readonly type:       "key" | "delta";
  readonly timestamp:  number;
  readonly duration:   number | null;
  readonly byteLength: number;
  copyTo(destination: BufferSource): void;
}

declare class VideoDecoder {
  constructor(init: VideoDecoderInit);
  readonly state:            "unconfigured" | "configured" | "closed";
  readonly decodeQueueSize:  number;
  static isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport>;
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
}
