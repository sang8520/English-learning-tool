/**
 * 一键构建国内安卓商店可用的签名 APK。
 *
 * 用法（仓库根目录）：
 *   node release/android/build-release.mjs
 *   node release/android/build-release.mjs --aab      # 额外产出 Google Play 用 AAB
 *
 * 首次运行会自动生成签名密钥库（release/android/keystore/），
 * 请立刻备份该目录：丢失后无法再更新已上架的应用。
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(ROOT, "..", "..");
const MOBILE = join(REPO, "mobile");
const ANDROID = join(MOBILE, "android");
const KEYSTORE_DIR = join(ROOT, "keystore");
const KEYSTORE = join(KEYSTORE_DIR, "english-learning.jks");
const CREDENTIALS = join(KEYSTORE_DIR, "credentials.txt");
const KEY_PROPERTIES = join(ANDROID, "keystore.properties");
const OUT = join(ROOT, "out");
const VERSION = JSON.parse(readFileSync(join(ROOT, "version.json"), "utf8"));
const BUILD_AAB = process.argv.includes("--aab");

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO,
    stdio: "inherit",
    shell: options.shell ?? (process.platform === "win32"),
    env: { ...process.env, ...options.env },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function javaTool(name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  if (process.env.JAVA_HOME) {
    const candidate = join(process.env.JAVA_HOME, "bin", executable);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function ensureKeystore() {
  const hasKeystore = existsSync(KEYSTORE);
  const hasProperties = existsSync(KEY_PROPERTIES);
  if (hasKeystore && hasProperties) return;

  if (hasKeystore || hasProperties || existsSync(CREDENTIALS)) {
    console.error("签名材料不完整：keystore、keystore.properties、credentials.txt 必须同时存在。");
    console.error("请从备份恢复 release/android/keystore，或整体移除后重新生成。");
    process.exit(1);
  }

  mkdirSync(KEYSTORE_DIR, { recursive: true });
  const password = randomBytes(18).toString("base64url");
  run(javaTool("keytool"), [
    "-genkeypair",
    "-v",
    "-keystore", KEYSTORE,
    "-alias", "english-learning",
    "-keyalg", "RSA",
    "-keysize", "4096",
    "-validity", "10000",
    "-storetype", "PKCS12",
    "-storepass", password,
    "-keypass", password,
    "-dname", "CN=EnglishLearning,OU=Mobile,O=EnglishLearning,L=Beijing,ST=Beijing,C=CN",
  ], { shell: false });

  const storeFile = relative(ANDROID, KEYSTORE).replace(/\\/g, "/");
  writeFileSync(
    KEY_PROPERTIES,
    [
      `storeFile=${storeFile}`,
      `storePassword=${password}`,
      "keyAlias=english-learning",
      `keyPassword=${password}`,
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    CREDENTIALS,
    [
      "英语学习 Android 签名密钥",
      "",
      `keystore: ${relative(REPO, KEYSTORE)}`,
      "alias: english-learning",
      `storePassword: ${password}`,
      `keyPassword: ${password}`,
      "",
      "务必离线备份本目录；丢失密钥后将无法更新已上架的应用。",
      "不要把该目录提交到 git 或发给他人。",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`\n已生成签名密钥：${KEYSTORE}`);
  console.log("请立即备份 release/android/keystore/ 目录。");
}

function findApksigner() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const buildTools = join(sdk, "build-tools");
  if (!existsSync(buildTools)) return null;
  const versions = readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = join(
      buildTools,
      version,
      process.platform === "win32" ? "apksigner.bat" : "apksigner",
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

ensureKeystore();
mkdirSync(OUT, { recursive: true });

const apiBase = (process.env.VITE_API_BASE || "").trim();
console.log(`[release] 版本：${VERSION.versionName} (${VERSION.versionCode})`);
console.log(`[release] 默认接口基址：${apiBase || "未指定（用户可在 App 内设置）"}`);

run("corepack", ["pnpm", "--dir", "mobile", "web:build"], {
  env: { VITE_API_BASE: apiBase },
});
run("corepack", ["pnpm", "--dir", "mobile", "sync"]);

const gradleArgs = [
  "assembleRelease",
  ...(BUILD_AAB ? ["bundleRelease"] : []),
  `-PversionCode=${VERSION.versionCode}`,
  `-PversionName=${VERSION.versionName}`,
];
run(join(ANDROID, process.platform === "win32" ? "gradlew.bat" : "gradlew"), gradleArgs, {
  cwd: ANDROID,
});

const apkSource = join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk");
const apkTarget = join(OUT, `英语学习-${VERSION.versionName}.apk`);
copyFileSync(apkSource, apkTarget);
console.log(`\n[release] APK -> ${apkTarget}`);

if (BUILD_AAB) {
  const aabSource = join(ANDROID, "app", "build", "outputs", "bundle", "release", "app-release.aab");
  const aabTarget = join(OUT, `英语学习-${VERSION.versionName}.aab`);
  copyFileSync(aabSource, aabTarget);
  console.log(`[release] AAB -> ${aabTarget}`);
}

const apksigner = findApksigner();
if (apksigner) {
  run(apksigner, ["verify", "--print-certs", apkTarget]);
} else {
  console.log("[release] 未找到 apksigner，跳过签名校验（请确认 ANDROID_HOME 已设置）");
}
