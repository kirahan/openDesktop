import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UserScriptsFile } from "../userScripts/types.js";
import { USER_SCRIPTS_STORE_SCHEMA_VERSION } from "../userScripts/types.js";
import type { AppDefinition, AppsFile, ProfileDefinition, ProfilesFile } from "./types.js";
import { STORE_SCHEMA_VERSION } from "./types.js";

export class JsonFileStore {
  constructor(private readonly dataDir: string) {}

  private appsPath() {
    return path.join(this.dataDir, "apps.json");
  }

  private profilesPath() {
    return path.join(this.dataDir, "profiles.json");
  }

  private userScriptsPath() {
    return path.join(this.dataDir, "user-scripts.json");
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
  }

  /** Atomic write: write to .tmp then rename */
  async atomicWriteJson(filePath: string, data: unknown): Promise<void> {
    await this.ensureDir();
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(data, null, 2);
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, filePath);
  }

  async readApps(): Promise<AppsFile> {
    try {
      const raw = await readFile(this.appsPath(), "utf8");
      const parsed = JSON.parse(raw) as AppsFile;
      if (typeof parsed.schemaVersion !== "number") {
        throw new Error("INVALID_SCHEMA: missing schemaVersion");
      }
      if (!Array.isArray(parsed.apps)) {
        throw new Error("INVALID_SCHEMA: apps must be array");
      }
      return parsed;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return { schemaVersion: STORE_SCHEMA_VERSION, apps: [] };
      }
      throw e;
    }
  }

  async writeApps(apps: AppDefinition[]): Promise<void> {
    const data: AppsFile = { schemaVersion: STORE_SCHEMA_VERSION, apps };
    await this.atomicWriteJson(this.appsPath(), data);
  }

  async readProfiles(): Promise<ProfilesFile> {
    try {
      const raw = await readFile(this.profilesPath(), "utf8");
      const parsed = JSON.parse(raw) as ProfilesFile;
      if (typeof parsed.schemaVersion !== "number") {
        throw new Error("INVALID_SCHEMA: missing schemaVersion");
      }
      if (!Array.isArray(parsed.profiles)) {
        throw new Error("INVALID_SCHEMA: profiles must be array");
      }
      return parsed;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return { schemaVersion: STORE_SCHEMA_VERSION, profiles: [] };
      }
      throw e;
    }
  }

  async writeProfiles(profiles: ProfileDefinition[]): Promise<void> {
    const data: ProfilesFile = { schemaVersion: STORE_SCHEMA_VERSION, profiles };
    await this.atomicWriteJson(this.profilesPath(), data);
  }

  async readUserScripts(): Promise<UserScriptsFile> {
    try {
      const raw = await readFile(this.userScriptsPath(), "utf8");
      const parsed = JSON.parse(raw) as UserScriptsFile;
      if (typeof parsed.schemaVersion !== "number") {
        throw new Error("INVALID_SCHEMA: missing schemaVersion");
      }
      if (!Array.isArray(parsed.scripts)) {
        throw new Error("INVALID_SCHEMA: scripts must be array");
      }
      return parsed;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return { schemaVersion: USER_SCRIPTS_STORE_SCHEMA_VERSION, scripts: [] };
      }
      throw e;
    }
  }

  async writeUserScripts(scripts: UserScriptsFile["scripts"]): Promise<void> {
    const data: UserScriptsFile = {
      schemaVersion: USER_SCRIPTS_STORE_SCHEMA_VERSION,
      scripts,
    };
    await this.atomicWriteJson(this.userScriptsPath(), data);
  }

  /** Intentionally corrupt file for recovery tests */
  async writeCorruptApps(): Promise<void> {
    await this.ensureDir();
    await writeFile(this.appsPath(), "{ not json", "utf8");
  }

  async removeApps(): Promise<void> {
    try {
      await unlink(this.appsPath());
    } catch {
      /* ignore */
    }
  }
}
