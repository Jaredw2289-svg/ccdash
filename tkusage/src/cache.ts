import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
    RateLimitSnapshot,
    UsageRecord,
    UsageSource
} from './types';

interface CachedFileEntry {
    latestRateLimits: RateLimitSnapshot | null;
    mtimeMs: number;
    records: UsageRecord[];
    size: number;
    source: UsageSource;
    variant: string;
}

interface UsageCacheFile {
    files: Record<string, CachedFileEntry>;
    version: 2;
}

function getCacheRoot(): string {
    if (process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.trim() !== '') {
        return path.join(process.env.XDG_CACHE_HOME, 'tkusage');
    }

    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Caches', 'tkusage');
    }

    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
        return path.join(process.env.LOCALAPPDATA, 'tkusage', 'Cache');
    }

    return path.join(os.homedir(), '.cache', 'tkusage');
}

export function getUsageCacheFilePath(): string {
    return path.join(getCacheRoot(), 'usage-cache-v2.json');
}

export function hasUsageCache(): boolean {
    return fs.existsSync(getUsageCacheFilePath());
}

function isValidCacheFile(value: unknown): value is UsageCacheFile {
    return typeof value === 'object'
        && value !== null
        && 'version' in value
        && value.version === 2
        && 'files' in value
        && typeof value.files === 'object'
        && value.files !== null;
}

function getCacheKey(filePath: string, variant: string): string {
    return `${variant}\u0000${filePath}`;
}

function getFilePathFromCacheKey(key: string): string {
    const separatorIndex = key.indexOf('\u0000');
    return separatorIndex === -1 ? key : key.slice(separatorIndex + 1);
}

export class UsageCacheStore {
    private cacheFilePath: string;
    private data: UsageCacheFile;
    private dirty = false;

    public constructor() {
        this.cacheFilePath = getUsageCacheFilePath();
        this.data = this.load();
    }

    public get(
        filePath: string,
        source: UsageSource,
        mtimeMs: number,
        size: number,
        variant = 'default'
    ): CachedFileEntry | null {
        const cached = this.data.files[getCacheKey(filePath, variant)];
        if (!cached) {
            return null;
        }

        if (cached.source !== source || cached.mtimeMs !== mtimeMs || cached.size !== size || cached.variant !== variant) {
            return null;
        }

        return cached;
    }

    public prune(source: UsageSource, existingFiles: Set<string>): void {
        for (const [cacheKey, entry] of Object.entries(this.data.files)) {
            if (entry.source === source && !existingFiles.has(getFilePathFromCacheKey(cacheKey))) {
                delete this.data.files[cacheKey];
                this.dirty = true;
            }
        }
    }

    public save(): void {
        if (!this.dirty) {
            return;
        }

        fs.mkdirSync(path.dirname(this.cacheFilePath), { recursive: true });
        fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.data), 'utf8');
        this.dirty = false;
    }

    public set(
        filePath: string,
        source: UsageSource,
        mtimeMs: number,
        size: number,
        records: UsageRecord[],
        latestRateLimits: RateLimitSnapshot | null,
        variant = 'default'
    ): void {
        this.data.files[getCacheKey(filePath, variant)] = {
            latestRateLimits,
            mtimeMs,
            records,
            size,
            source,
            variant
        };
        this.dirty = true;
    }

    private load(): UsageCacheFile {
        try {
            if (!fs.existsSync(this.cacheFilePath)) {
                return { version: 2, files: {} };
            }

            const parsed = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8')) as unknown;
            return isValidCacheFile(parsed) ? parsed : { version: 2, files: {} };
        } catch {
            return { version: 2, files: {} };
        }
    }
}
