import { existsSync, readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

export interface Config {
  streaming: boolean;
}

const DEFAULT_CONFIG: Config = {
  streaming: true,
};

let config: Config | null = null;

export function loadConfig(): Config {
  if (config) return config;

  const configPath = join(process.cwd(), "smallbot.yaml");
  
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = yaml.load(raw) as Partial<Config>;
      config = { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
      console.warn("Failed to parse smallbot.yaml, using defaults");
      config = { ...DEFAULT_CONFIG };
    }
  } else {
    config = { ...DEFAULT_CONFIG };
  }

  return config;
}

export function getConfig(): Config {
  return config ?? loadConfig();
}
