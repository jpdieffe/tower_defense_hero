// Downloads the CC0 (public domain) asset packs used by Bulwark and extracts the
// subset we actually ship into `public/assets`.
//
// All packs are by Kenney (kenney.nl) and licensed Creative Commons CC0 1.0.
//
//   node scripts/fetch-assets.mjs            # download + extract
//   node scripts/fetch-assets.mjs --list     # just print the zip contents
//
// A tiny ZIP reader is implemented inline so this works on any OS with no
// external tooling (Node's stdlib has inflate, but no unzip).

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.tmp-assets');
const OUT = path.join(ROOT, 'public', 'assets');

/** @type {{name: string, url: string, pick: (entry: string) => string | null}[]} */
const PACKS = [
  {
    name: 'kenney_tower-defense-top-down',
    url: 'https://kenney.nl/media/pages/assets/tower-defense-top-down/729844df28-1677693738/kenney_tower-defense-top-down.zip',
    pick: (e) => {
      const base = path.posix.basename(e);
      if (/^towerDefense_tilesheet(@2)?\.png$/i.test(base)) return `sprites/${base}`;
      return null;
    },
  },
  {
    name: 'kenney_interface-sounds',
    url: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
    pick: (e) => {
      const base = path.posix.basename(e).toLowerCase();
      if (!e.startsWith('Audio/')) return null;
      const keep = [
        'click_001.ogg', 'click_002.ogg', 'switch_001.ogg', 'confirmation_001.ogg',
        'error_006.ogg', 'question_002.ogg', 'select_001.ogg', 'drop_001.ogg',
        'maximize_006.ogg', 'minimize_006.ogg', 'bong_001.ogg',
      ];
      return keep.includes(base) ? `sfx/${base}` : null;
    },
  },
  {
    name: 'kenney_impact-sounds',
    url: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
    pick: (e) => {
      const base = path.posix.basename(e).toLowerCase();
      if (!e.startsWith('Audio/')) return null;
      const keep = [
        'impactmining_000.ogg', 'impactmining_001.ogg', 'impactmining_003.ogg',
        'impactpunch_medium_000.ogg', 'impactpunch_medium_001.ogg',
        'impactplate_medium_000.ogg', 'impactplate_medium_003.ogg',
        'impactbell_heavy_001.ogg', 'impactmetal_heavy_003.ogg',
        'impactsoft_medium_000.ogg', 'impactsoft_medium_003.ogg',
        'impactglass_medium_000.ogg',
      ];
      return keep.includes(base) ? `sfx/${base}` : null;
    },
  },
  {
    name: 'kenney_music-jingles',
    url: 'https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip',
    pick: (e) => {
      const base = path.posix.basename(e).toLowerCase();
      if (!e.startsWith('Audio/')) return null;
      // Short stingers: wave start / wave clear / victory / defeat / level up.
      const keep = [
        'jingles_nes00.ogg', 'jingles_nes07.ogg', 'jingles_nes10.ogg',
        'jingles_nes13.ogg', 'jingles_nes16.ogg',
      ];
      return keep.includes(base) ? `music/${base}` : null;
    },
  },
];

// ---------------------------------------------------------------- zip reader

function readZipEntries(buf) {
  // Locate the End Of Central Directory record (scan backwards over the comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no EOCD record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('bad local file header');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.method}`);
}

// ------------------------------------------------------------------- driver

async function download(url, dest) {
  if (existsSync(dest)) return dest;
  process.stdout.write(`  downloading ${path.basename(dest)} ... `);
  const res = await fetch(url, { headers: { 'user-agent': 'bulwark-asset-fetch' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  process.stdout.write('ok\n');
  return dest;
}

async function main() {
  const listOnly = process.argv.includes('--list');
  await mkdir(CACHE, { recursive: true });

  for (const pack of PACKS) {
    console.log(`\n[${pack.name}]`);
    const zipPath = path.join(CACHE, `${pack.name}.zip`);
    await download(pack.url, zipPath);
    const buf = await readFile(zipPath);
    const entries = readZipEntries(buf);

    if (listOnly) {
      for (const e of entries) console.log('   ', e.name);
      continue;
    }

    let written = 0;
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      const target = pack.pick(e.name);
      if (!target) continue;
      const dest = path.join(OUT, target);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, extractEntry(buf, e));
      written++;
    }
    console.log(`  extracted ${written} file(s)`);
  }

  if (!listOnly) {
    await mkdir(OUT, { recursive: true });
    await writeFile(
      path.join(OUT, 'CREDITS.txt'),
      [
        'Third-party assets bundled with Bulwark',
        '=======================================',
        '',
        'Sprites : "Tower Defense (Top-Down)" by Kenney - https://kenney.nl/assets/tower-defense-top-down',
        'Audio   : "Interface Sounds"        by Kenney - https://kenney.nl/assets/interface-sounds',
        'Audio   : "Impact Sounds"           by Kenney - https://kenney.nl/assets/impact-sounds',
        'Music   : "Music Jingles"           by Kenney - https://kenney.nl/assets/music-jingles',
        'Audio   : "Magic Spell SFX"         by JaggedStone - https://opengameart.org/content/magic-spell-sfx',
        '',
        'All of the above are released under Creative Commons CC0 1.0 Universal',
        '(public domain dedication): https://creativecommons.org/publicdomain/zero/1.0/',
        'No attribution is required, but it is appreciated - so, thanks Kenney!',
        '',
      ].join('\n'),
    );
    console.log(`\nAssets written to ${path.relative(ROOT, OUT)}`);
  }
}

main().catch((err) => {
  console.error(err);
  rm(CACHE, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
});
