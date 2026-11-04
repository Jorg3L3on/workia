import { describe, expect, it } from "vitest";

import { presignUrl, uriEncode } from "./sigv4";

describe("presignUrl", () => {
  // The worked example of AWS's "Authenticating Requests: Using Query
  // Parameters" page (examplebucket, test.txt, 24 hours).
  it("matches the AWS documentation example", () => {
    const url = presignUrl({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });

    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("signs extra response parameters in sorted order", () => {
    const url = presignUrl({
      method: "GET",
      host: "s3.example.com",
      path: "/bucket/a b.pdf",
      region: "auto",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      expiresInSeconds: 300,
      query: { "response-content-type": "application/pdf" },
      now: new Date("2026-11-04T00:00:00Z"),
    });

    expect(url).toMatch(/^https:\/\/s3\.example\.com\/bucket\/a%20b\.pdf\?/);
    expect(url.indexOf("X-Amz-Signature")).toBeGreaterThan(
      url.indexOf("response-content-type=application%2Fpdf"),
    );
  });
});

describe("uriEncode", () => {
  it("encodes UTF-8 bytes and keeps unreserved characters", () => {
    expect(uriEncode("Acta_nacimiento-1.~ñ")).toBe("Acta_nacimiento-1.~%C3%B1");
    expect(uriEncode("a/b", true)).toBe("a/b");
    expect(uriEncode("a/b")).toBe("a%2Fb");
  });
});
