import { Type } from "@sinclair/typebox";

export const tool = {
  name: "web_search",
  description:
    "Search the web for current information. Returns top results with titles, URLs, and snippets.",
  parameters: Type.Object({
    query: Type.String({ description: "What to search for" }),
  }),
};

export async function handler(args: { query: string }): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_SEARCH_API_KEY environment variable is not set");
  }

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}`,
    {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const results = data.web?.results || [];

  if (!results.length) return "No results found.";

  return results
    .slice(0, 5)
    .map((r: any) => `**${r.title}**\n${r.url}\n${r.description || ""}`)
    .join("\n\n");
}
