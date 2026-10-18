import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import type { McpClient } from "@/lib/db/schema";

import {
  authenticateClient,
  isAcceptableRedirectUri,
  isChatgptClient,
  isMetadataUrlClientId,
  isRegisteredRedirectUri,
  parseMetadataDocument,
} from "./clients";
import { generateToken } from "../tokens";

const client = (overrides: Partial<McpClient> = {}): McpClient => ({
  id: "1",
  clientId: "c1",
  clientName: "Cliente",
  registration: "dcr",
  redirectUris: ["https://app.example/callback"],
  grantTypes: ["authorization_code"],
  tokenEndpointAuthMethod: "none",
  clientUri: null,
  logoUri: null,
  clientSecretHash: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("ChatGPT identification (D-01, D-05)", () => {
  it("recognizes a CIMD client_id on an OpenAI host", () => {
    expect(
      isChatgptClient({
        clientId: "https://chatgpt.com/oauth/abc/client.json",
        redirectUris: [],
      }),
    ).toBe(true);
  });

  it("recognizes a ChatGPT connector redirect URI (DCR)", () => {
    expect(
      isChatgptClient({
        clientId: "4f1c…",
        redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      }),
    ).toBe(true);
  });

  it("does not flag look-alike hosts or other clients", () => {
    expect(
      isChatgptClient({
        clientId: "https://chatgpt.com.evil.io/client.json",
        redirectUris: [],
      }),
    ).toBe(false);
    expect(
      isChatgptClient({
        clientId: "abc",
        redirectUris: ["https://grok.com/oauth/callback"],
      }),
    ).toBe(false);
  });
});

describe("Client ID Metadata Documents", () => {
  it("only fetches public https URLs (no SSRF to local hosts)", () => {
    expect(isMetadataUrlClientId("https://cursor.com/oauth/client.json")).toBe(
      true,
    );
    expect(isMetadataUrlClientId("http://cursor.com/oauth/client.json")).toBe(
      false,
    );
    expect(isMetadataUrlClientId("https://localhost/client.json")).toBe(false);
    expect(isMetadataUrlClientId("https://169.254.169.254/latest")).toBe(false);
    expect(isMetadataUrlClientId("https://db.internal/x")).toBe(false);
    expect(isMetadataUrlClientId("https://cursor.com/")).toBe(false);
  });

  it("requires the document to name the URL it came from", () => {
    const url = "https://client.example/oauth.json";

    expect(
      parseMetadataDocument(url, {
        client_id: url,
        redirect_uris: ["https://client.example/cb"],
      }),
    ).not.toBeNull();
    expect(
      parseMetadataDocument(url, {
        client_id: "https://other.example/oauth.json",
        redirect_uris: ["https://client.example/cb"],
      }),
    ).toBeNull();
  });
});

describe("redirect URIs and client authentication", () => {
  it("accepts https and loopback http, without fragments", () => {
    expect(isAcceptableRedirectUri("https://a.example/cb")).toBe(true);
    expect(
      isAcceptableRedirectUri("http://127.0.0.1:6274/oauth/callback"),
    ).toBe(true);
    expect(isAcceptableRedirectUri("http://a.example/cb")).toBe(false);
    expect(isAcceptableRedirectUri("https://a.example/cb#x")).toBe(false);
  });

  it("matches registered redirect URIs exactly", () => {
    expect(
      isRegisteredRedirectUri(client(), "https://app.example/callback"),
    ).toBe(true);
    expect(
      isRegisteredRedirectUri(client(), "https://app.example/callback/"),
    ).toBe(false);
  });

  it("checks the secret of client_secret_post clients only", () => {
    const secret = generateToken("clientSecret");
    const confidential = client({
      tokenEndpointAuthMethod: "client_secret_post",
      clientSecretHash: secret.hash,
    });

    expect(authenticateClient(client(), undefined)).toBe(true);
    expect(authenticateClient(confidential, secret.token)).toBe(true);
    expect(authenticateClient(confidential, "otro")).toBe(false);
    expect(authenticateClient(confidential, undefined)).toBe(false);
  });
});
