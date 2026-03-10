#!/usr/bin/env bun

import {
    readFileSync,
    writeFileSync
} from 'fs';
import { join } from 'path';

interface PackageJson {
    version: string;
    [key: string]: unknown;
}

// Read package.json to get version
const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as PackageJson;
const version = packageJson.version;

const bundledFiles = [
    join('dist', 'ccstatusline.js')
];

for (const bundledFilePath of bundledFiles) {
    let bundledContent = readFileSync(bundledFilePath, 'utf-8');
    bundledContent = bundledContent.replace(/__PACKAGE_VERSION__/g, version);
    writeFileSync(bundledFilePath, bundledContent);
}

console.log(`✓ Replaced version placeholder with ${version} in ${bundledFiles.length} bundles`);