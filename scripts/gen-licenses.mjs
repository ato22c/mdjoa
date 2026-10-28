// Generates THIRD-PARTY-LICENSES.txt from the bundled font OFL notices plus the
// production npm dependency licenses (read straight from package-lock.json +
// node_modules — no network, honoring the project's no-network rule).
//
// Outputs two identical copies:
//   - src/generated/third-party-licenses.txt   (imported into the About screen)
//   - src-tauri/resources/THIRD-PARTY-LICENSES.txt (bundled into the .app)
//
// Run automatically as the first step of `npm run build`.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEP = "=".repeat(80);
const SUB = "-".repeat(80);

// --- SIL Open Font License 1.1 (verbatim) ------------------------------------
const OFL_1_1 = `SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide development of collaborative font projects, to support the font creation efforts of academic and linguistic communities, and to provide a free and open framework in which fonts may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed freely as long as they are not sold by themselves. The fonts, including any derivative works, can be bundled, embedded, redistributed and/or sold with any software provided that any reserved names are not used by derivative works. The fonts and derivatives, however, cannot be released under any other type of license. The requirement for fonts to remain under this license does not apply to any document created using the fonts or their derivatives.

DEFINITIONS

"Font Software" refers to the set of files released by the Copyright Holder(s) under this license and clearly marked as such. This may include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright statement(s).

"Original Version" refers to the collection of Font Software components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or substituting -- in part or in whole -- any of the components of the Original Version, by changing formats or by porting the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the following conditions:

1. Neither the Font Software nor any of its individual components, in Original or Modified Versions, may be sold by itself.

2. Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold with any software, provided that each copy contains the above copyright notice and this license. These can be included either as stand-alone text files, human-readable headers or in the appropriate machine-readable metadata fields within text or binary files as long as those fields can be easily viewed by the user.

3. No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted by the corresponding Copyright Holder. This restriction only applies to the primary font name as presented to the users.

4. The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software shall not be used to promote, endorse or advertise any Modified Version, except to acknowledge the contribution(s) of the Copyright Holder(s) and the Author(s) or with their explicit written permission.

5. The Font Software, modified or unmodified, in part or in whole, must be distributed entirely under this license, and must not be distributed under any other license. The requirement for fonts to remain under this license does not apply to any document created using the Font Software.

TERMINATION

This license becomes null and void if any of the above conditions are not met.

DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.`;

const fontsBlock = `${SEP}
번들 폰트 (Bundled Fonts)
${SEP}

이 애플리케이션은 다음 폰트를 동봉하며, 각 폰트는 SIL Open Font License 1.1에
따라 배포됩니다.

  - Pretendard
    Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard),
    with Reserved Font Name Pretendard.

  - JetBrains Mono
    Copyright 2020 The JetBrains Mono Project Authors
    (https://github.com/JetBrains/JetBrainsMono)

  - D2Coding
    Copyright (c) NAVER Corp. (https://github.com/naver/d2codingfont)
    with Reserved Font Name D2Coding.

${SUB}
${OFL_1_1}
`;

// --- npm production dependencies ---------------------------------------------
const LICENSE_FILE_RE = /^(LICEN[SC]E|COPYING|OFL)(\b|[-.]|$)/i;

function findLicenseText(pkgDir) {
  try {
    const file = readdirSync(join(root, pkgDir)).find((f) => LICENSE_FILE_RE.test(f));
    if (file) return readFileSync(join(root, pkgDir, file), "utf8").trim();
  } catch {
    /* directory missing or unreadable — fall through */
  }
  return null;
}

function collectNpm() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const seen = new Map(); // name@version -> entry
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key) continue; // root project
    if (entry.dev || entry.devOptional) continue; // production deps only
    const name = entry.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    const version = entry.version ?? "";
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      name,
      version,
      license: typeof entry.license === "string" ? entry.license : (entry.license?.type ?? "UNKNOWN"),
      text: findLicenseText(key),
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const deps = collectNpm();
const depBlocks = deps
  .map((d) => {
    const head = `${SUB}\n${d.name} ${d.version}  —  ${d.license}\n${SUB}`;
    return d.text ? `${head}\n${d.text}` : `${head}\n(라이선스 전문이 패키지에 포함되어 있지 않습니다. 선언된 라이선스: ${d.license})`;
  })
  .join("\n\n");

const out = `MD좋아 — 제3자 라이선스 고지 (THIRD-PARTY LICENSES)

이 파일은 빌드 시 자동 생성됩니다 (scripts/gen-licenses.mjs).
동봉 폰트의 OFL 전문과 ${deps.length}개 오픈소스 의존성의 라이선스를 포함합니다.

${fontsBlock}

${SEP}
오픈소스 의존성 (Open-Source Dependencies) — ${deps.length}개
${SEP}

${depBlocks}
`;

const targets = [
  join(root, "src", "generated", "third-party-licenses.txt"),
  join(root, "src-tauri", "resources", "THIRD-PARTY-LICENSES.txt"),
];
for (const t of targets) {
  mkdirSync(dirname(t), { recursive: true });
  writeFileSync(t, out, "utf8");
}
console.log(`[gen-licenses] ${deps.length} npm deps + 2 fonts → ${targets.length} files`);
