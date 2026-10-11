import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { signBlobToken } from "./auth/session";

/**
 * Where EPUBs and reader data live. Cloudflare R2 (S3-compatible) when R2_* is configured;
 * otherwise a local folder, for development. Browsers never get bucket credentials:
 * uploads and downloads use short-lived URLs from `uploadUrl` / `downloadUrl`.
 */
export interface Storage {
  readonly kind: "r2" | "local";
  getBytes(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** A URL the browser can PUT exactly `bytes` bytes of `contentType` to. */
  uploadUrl(key: string, contentType: string, bytes: number): Promise<string>;
  downloadUrl(key: string): Promise<string>;
}

const URL_TTL_SECONDS = 15 * 60;
export const MAX_EPUB_BYTES = 100 * 1024 * 1024;

class R2Storage implements Storage {
  readonly kind = "r2";
  private client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  private bucket = process.env.R2_BUCKET!;

  async getBytes(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async put(key: string, body: Uint8Array | string, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  uploadUrl(key: string, contentType: string, bytes: number) {
    // Content-Length is signed into the URL, so the upload can't be larger than declared.
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: bytes }),
      { expiresIn: URL_TTL_SECONDS, signableHeaders: new Set(["content-length", "content-type"]) },
    );
  }

  downloadUrl(key: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: URL_TTL_SECONDS,
    });
  }
}

/** Development storage in ./.data, served through /api/blob with signed, expiring tokens. */
class LocalStorage implements Storage {
  readonly kind = "local";
  private root = join(process.cwd(), ".data");

  private path(key: string) {
    const path = normalize(join(this.root, key));
    if (!path.startsWith(this.root + "/")) throw new Error(`Invalid storage key: ${key}`);
    return path;
  }

  async getBytes(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(key: string, body: Uint8Array | string) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }

  async uploadUrl(key: string, _contentType: string, bytes: number) {
    return `/api/blob/${key}?token=${await signBlobToken(key, "put", URL_TTL_SECONDS, bytes)}`;
  }

  async downloadUrl(key: string) {
    return `/api/blob/${key}?token=${await signBlobToken(key, "get", URL_TTL_SECONDS)}`;
  }
}

export const r2Configured = () =>
  Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

let storage: Storage | undefined;

export function getStorage(): Storage {
  if (storage) return storage;
  if (r2Configured()) return (storage = new R2Storage());
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "1") {
    throw new Error("R2 is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).");
  }
  return (storage = new LocalStorage());
}

export async function getJson<T>(key: string): Promise<T | null> {
  const bytes = await getStorage().getBytes(key);
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
}

export function putJson(key: string, value: unknown): Promise<void> {
  return getStorage().put(key, JSON.stringify(value), "application/json");
}
