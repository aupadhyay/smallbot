import { load } from "js-yaml";
import { readFileSync } from "fs";

type Prompts = Record<string, string>;

let prompts: Prompts | null = null;

export function loadPrompts(): Prompts {
  if (!prompts) {
    const content = readFileSync("prompts.yaml", "utf-8");
    prompts = load(content) as Prompts;
  }
  return prompts;
}

export function getPrompt(name: string): string {
  const p = loadPrompts()[name];
  if (!p) throw new Error(`Prompt "${name}" not found in prompts.yaml`);
  return p;
}
