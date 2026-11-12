import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const ignoredDirectories = new Set(["node_modules", ".next", ".expo", "dist", "build", ".pytest_cache"]);
const walk = (directory, extensions) => fs.existsSync(directory)
  ? fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) || entry.name.startsWith(".expo-") ? [] : walk(target, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [target] : [];
  })
  : [];
const sourceCache = new Map();
const sourceOf = (file) => {
  if (sourceCache.has(file)) return sourceCache.get(file);
  let source = "";
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
  } catch (error) {
    if (error.code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw error;
    failures.push(`${path.relative(root, file)} contains invalid UTF-8; save source as UTF-8`);
  }
  sourceCache.set(file, source);
  return source;
};
const report = (file, source, index, description) => {
  const line = source.slice(0, index).split(/\r?\n/).length;
  failures.push(`${path.relative(root, file)}:${line} ${description}`);
};
const inspect = (file, patterns) => {
  const source = sourceOf(file);
  for (const [description, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) report(file, source, match.index, description);
  }
};

const literalTypography = [
  ["contains a literal font family; declare it in shared typography", /\bfontFamily\s*:\s*["'`](?!var\()[^"'`]+["'`]/g],
  ["contains a literal font size; use shared typography", /\bfontSize\s*:\s*(?:-?\d|\.\d|["'`]\s*(?:\d|\.\d))/g],
  ["contains a literal font weight; use typography.weight", /\bfontWeight\s*:\s*(?:\d|["'`](?:\d+|normal|bold|bolder|lighter)["'`])/g],
  ["contains a literal font size prop; use shared typography", /\bfontSize\s*=\s*(?:["'`]\s*(?:\d|\.\d)|\{\s*(?:\d|\.\d))/g],
  ["contains a literal font family prop; use shared typography", /\bfontFamily\s*=\s*["'`](?!var\()[^"'`]+["'`]/g],
  ["contains a literal font weight prop; use shared typography", /\bfontWeight\s*=\s*(?:["'`](?:\d+|normal|bold|bolder|lighter)["'`]|\{\s*\d)/g],
];
const rawColor = /(["'`])(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([^"'`]+\))\1/gi;
const mobileFiles = walk(path.join(root, "apps/mobile"), [".tsx", ".ts"]);
for (const file of mobileFiles) inspect(file, [
  ["contains a raw color; use colors or palette from @ecochef/design-tokens", rawColor],
  ...literalTypography,
]);

const webFiles = ["app", "src"].flatMap((directory) => walk(path.join(root, "apps/web", directory), [".css", ".tsx", ".ts"]));
for (const file of webFiles) inspect(file, [
  ["contains a raw color; use an EcoChef CSS variable or design token", /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\(\s*[-+.%\d]/gi],
  ["contains a named color; use an EcoChef CSS variable or design token", /(?:color|background):\s*(?:white|black)\b/gi],
  ["contains a literal CSS font family; use a shared token", /font-family:\s*(?!var\(|inherit\b|unset\b)[a-z"']/gi],
  ["contains a literal CSS font size; use an EcoChef CSS variable", /font-size:\s*(?:\d|\.\d|(?:xx?-)?(?:small|large)\b|medium\b)/gi],
  ["contains a literal CSS font weight; use an EcoChef CSS variable", /font-weight:\s*(?:\d|bold\b|normal\b|bolder\b|lighter\b)/gi],
  ["contains a literal CSS line height; use an EcoChef CSS variable", /line-height:\s*(?:\d|\.\d)/gi],
  ...literalTypography,
]);

const themedTextFile = path.join(root, "apps/mobile/src/shared/components/themed-text.tsx");
for (const file of mobileFiles) {
  if (file === themedTextFile) continue;
  const source = sourceOf(file);
  for (const match of source.matchAll(/import\s*\{([^{}]+)\}\s*from ["']react-native["']/g)) {
    if (match[1].split(",").some((name) => /^(Text|TextInput)(?:\s+as\s+\w+)?$/.test(name.trim()))) {
      report(file, source, match.index, "must use shared themed Text/TextInput");
    }
  }
  // Namespace access would otherwise bypass the shared font wrapper.
  for (const match of source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+["']react-native["']/g)) {
    const reference = new RegExp(`\\b${match[1]}\\.(?:Text|TextInput)\\b`);
    if (reference.test(source)) report(file, source, match.index, "must use shared themed Text/TextInput");
  }
}

const tokenFile = path.join(root, "packages/design-tokens/tokens.css");
const tokenCss = sourceOf(tokenFile);
const definitions = new Set([...tokenCss.matchAll(/(--ec-[a-z0-9_-]+)\s*:/g)].map((match) => match[1]));
for (const file of [tokenFile, ...webFiles]) {
  const source = sourceOf(file);
  for (const match of source.matchAll(/var\(\s*(--ec-[a-z0-9_-]+)/g)) {
    if (!definitions.has(match[1])) report(file, source, match.index, `references undefined token ${match[1]}`);
  }
}

if (failures.length) {
  console.error(`Theme compliance failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("Theme compliance passed: checked UI color/font literals, shared native text imports, and web token references.");
