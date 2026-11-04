import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 query-string signing ("presigned URLs") for any
 * S3-compatible bucket. Hand-written so the storage layer adds no dependency.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */

export type PresignInput = {
  method: "GET" | "PUT" | "DELETE";
  /** Origin of the bucket, e.g. https://<account>.r2.cloudflarestorage.com */
  host: string;
  protocol?: "https:" | "http:";
  /** Already-decoded path, e.g. /bucket/company/documents/person/file.pdf */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds: number;
  /** Extra signed query parameters (response-content-disposition, ...). */
  query?: Record<string, string>;
  now?: Date;
};

/** RFC 3986 encoding as SigV4 wants it; "/" kept in paths. */
export const uriEncode = (value: string, keepSlash = false) =>
  Array.from(new TextEncoder().encode(value))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      if (/[A-Za-z0-9\-_.~]/.test(char) || (keepSlash && char === "/")) {
        return char;
      }
      return `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");

const sha256Hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const hmac = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value, "utf8").digest();

/** yyyymmddThhmmssZ */
const amzDate = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export const presignUrl = (input: PresignInput) => {
  const now = input.now ?? new Date();
  const datetime = amzDate(now);
  const day = datetime.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;

  const params: Record<string, string> = {
    ...input.query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": datetime,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(params[key]!)}`)
    .join("&");
  const canonicalUri = uriEncode(input.path, true);

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    `host:${input.host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${input.protocol ?? "https:"}//${input.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
};
