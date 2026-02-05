/**
 * Example plugin template.
 *
 * To create a plugin:
 * 1. Copy this file to plugins/my-tool.ts (remove the _ prefix)
 * 2. Define `tool` with name, description, and TypeBox parameters
 * 3. Export a `handler` function that takes the params and returns a string
 * 4. Restart the bot
 *
 * Files prefixed with _ are skipped by the plugin loader.
 */

import { Type } from "@sinclair/typebox";

export const tool = {
  name: "example_tool",
  description: "An example tool that echoes input back",
  parameters: Type.Object({
    message: Type.String({ description: "The message to echo" }),
  }),
};

export async function handler(args: { message: string }): Promise<string> {
  return `Echo: ${args.message}`;
}
