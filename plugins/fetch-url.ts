import { Type } from "@sinclair/typebox";

export const tool = {
  name: "fetch_url",
  description:
    "Fetch the content of a URL. Returns the raw text content. Useful for reading web pages, APIs, or downloading files.",
  parameters: Type.Object({
    url: Type.String({ description: "The URL to fetch" }),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Optional HTTP headers to include",
      })
    ),
  }),
};

export async function handler(args: {
  url: string;
  headers?: Record<string, string>;
}): Promise<string> {
  const response = await fetch(args.url, {
    headers: {
      "User-Agent": "SmallBot/1.0",
      ...args.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  // Truncate very large responses
  const MAX_LENGTH = 50000;
  if (text.length > MAX_LENGTH) {
    return `[Content-Type: ${contentType}]\n[Truncated to ${MAX_LENGTH} chars, total: ${text.length}]\n\n${text.slice(0, MAX_LENGTH)}...`;
  }

  return `[Content-Type: ${contentType}]\n\n${text}`;
}
